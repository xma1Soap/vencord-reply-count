/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 xma1Soap and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageStore } from "@webpack/common";

/**
 * 回复索引：谁回复了谁。
 *
 * Discord 没有「这条消息被回复了几次」的接口，所以只能自己数：
 * 客户端收到的每一条消息（加载历史、实时新消息、手动扫描）都过一遍，
 * 是回复就记到被回复的那条消息名下。索引在本次运行期间一直保留，
 * 不会因为 Discord 把频道消息从内存里清掉而丢失。
 */

export interface ReplyInfo {
    id: string;
    channelId: string;
    authorId: string | undefined;
    content: string;
}

/** Discord 的「回复」消息类型 */
const MESSAGE_TYPE_REPLY = 19;

/** 被回复消息 id → (回复消息 id → 回复摘要) */
const repliesByTarget = new Map<string, Map<string, ReplyInfo>>();
/** 回复消息 id → 被回复消息 id，删除消息时用 */
const targetByReply = new Map<string, string>();

/**
 * 频道 id → 「从这条消息 id 开始一直到最新，所有消息都已经数过」。
 * 落在这个范围里的消息，计数就是完整的；更早的消息可能有回复没被加载到。
 */
const coveredFrom = new Map<string, string>();

/** 手动扫描到一半停下时记住进度，下次接着扫：频道 id → [起点, 已扫到] */
const partialScans = new Map<string, { from: string; to: string; }>();

// ---------- 订阅 ----------

const listeners = new Set<() => void>();
let notifyQueued = false;

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** 合并同一轮里的多次改动，只通知一次 */
export function emitChange() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
        notifyQueued = false;
        for (const l of listeners) {
            try { l(); } catch { }
        }
    });
}

// ---------- 雪花 id 比较（十进制字符串，无前导零）----------

export function compareIds(a: string, b: string) {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- 索引 ----------

function referencedId(message: any): string | null {
    if (!message || message.type !== MESSAGE_TYPE_REPLY) return null;
    const ref = message.messageReference ?? message.message_reference;
    if (!ref) return null;
    // type 1 是转发，不算回复
    if ((ref.type ?? 0) !== 0) return null;
    return ref.message_id ?? ref.messageId ?? null;
}

/** 记录一条消息。是新发现的回复才返回 true。 */
export function indexMessage(message: any, channelId?: string): boolean {
    if (!message?.id) return false;
    const target = referencedId(message);
    if (!target) return false;

    const isNew = targetByReply.get(message.id) !== target;

    let replies = repliesByTarget.get(target);
    if (!replies) repliesByTarget.set(target, replies = new Map());
    replies.set(message.id, {
        id: message.id,
        channelId: message.channel_id ?? message.channelId ?? channelId,
        authorId: message.author?.id,
        content: String(message.content ?? "").slice(0, 200),
    });
    targetByReply.set(message.id, target);

    return isNew;
}

/** 消息被删了就从计数里去掉。确实删掉了什么才返回 true。 */
export function removeMessage(id: string): boolean {
    const target = targetByReply.get(id);
    if (!target) return false;
    targetByReply.delete(id);
    const replies = repliesByTarget.get(target);
    replies?.delete(id);
    if (replies?.size === 0) repliesByTarget.delete(target);
    return true;
}

export function extendCoverage(channelId: string, fromId: string): boolean {
    const current = coveredFrom.get(channelId);
    if (current != null && compareIds(fromId, current) >= 0) return false;
    coveredFrom.set(channelId, fromId);
    return true;
}

export function getCoveredFrom(channelId: string) {
    return coveredFrom.get(channelId);
}

export function isComplete(channelId: string, messageId: string) {
    const from = coveredFrom.get(channelId);
    return from != null && compareIds(messageId, from) >= 0;
}

export function getReplyCount(messageId: string) {
    return repliesByTarget.get(messageId)?.size ?? 0;
}

/** 按时间先后排好的回复列表 */
export function getReplies(messageId: string): ReplyInfo[] {
    const replies = repliesByTarget.get(messageId);
    if (!replies) return [];
    return [...replies.values()].sort((a, b) => compareIds(a.id, b.id));
}

export function getStats() {
    return { targets: repliesByTarget.size, replies: targetByReply.size };
}

export function clearAll() {
    repliesByTarget.clear();
    targetByReply.clear();
    coveredFrom.clear();
    partialScans.clear();
    emitChange();
}

export function getPartialScan(channelId: string) {
    return partialScans.get(channelId);
}

export function setPartialScan(channelId: string, range: { from: string; to: string; } | null) {
    if (range) partialScans.set(channelId, range);
    else partialScans.delete(channelId);
}

// ---------- 和 Discord 自己的消息缓存同步 ----------

/** 频道当前加载窗口里最早的一条消息 */
export function getOldestLoadedId(channelId: string): string | undefined {
    const messages = MessageStore.getMessages(channelId);
    return messages?._array?.[0]?.id;
}

/**
 * 把 Discord 当前加载的这段消息全部过一遍。
 * 如果这段消息一直连到最新（hasMoreAfter 为 false），
 * 说明从它的第一条到现在的回复都数全了。
 */
export function syncChannel(channelId: string) {
    const messages = MessageStore.getMessages(channelId);
    if (!messages?._array?.length) return;

    let changed = false;
    for (const m of messages._array) {
        if (indexMessage(m, channelId)) changed = true;
    }

    if (messages.ready && !messages.cached && !messages.hasMoreAfter) {
        if (extendCoverage(channelId, messages._array[0].id)) changed = true;
    }

    if (changed) emitChange();
}

const pendingSyncs = new Set<string>();

/** 很多条消息同时渲染时会一起请求同步，合并成一次 */
export function requestSync(channelId: string) {
    if (!channelId || pendingSyncs.has(channelId)) return;
    pendingSyncs.add(channelId);
    setTimeout(() => {
        pendingSyncs.delete(channelId);
        try { syncChannel(channelId); } catch { }
    }, 50);
}
