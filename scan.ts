/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 xma1Soap and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { RestAPI } from "@webpack/common";

import { settings } from "./settings";
import {
    compareIds, emitChange, extendCoverage, getCoveredFrom, getOldestLoadedId, getPartialScan,
    indexMessage, setPartialScan
} from "./store";

/**
 * 手动扫描：从当前频道已加载的最早一条消息开始，往后翻到最新，
 * 把中间所有回复都数一遍。回复一定比被回复的消息晚，所以只要往后翻。
 */

export interface ScanState {
    channelId: string;
    pages: number;
    found: number;
    stopRequested: boolean;
}

let current: ScanState | null = null;
const scanListeners = new Set<() => void>();

export function getScanState() {
    return current;
}

export function subscribeScan(listener: () => void) {
    scanListeners.add(listener);
    return () => void scanListeners.delete(listener);
}

function emitScan() {
    for (const l of scanListeners) {
        try { l(); } catch { }
    }
}

/** 上一次扫描的结果，菜单里显示 */
let lastResult: string | null = null;

export function getLastResult() {
    return lastResult;
}

/** Discord 自带的 toast 在新版客户端里经常不显示，用 Vencord 自己的通知更可靠 */
function notify(body: string) {
    lastResult = body;
    showNotification({ title: "回复计数", body, noPersist: true });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function minusOne(id: string) {
    return (BigInt(id) - 1n).toString();
}

export function stopScan() {
    if (current) {
        current.stopRequested = true;
        emitScan();
    }
}

export async function scanChannel(channelId: string, startId = getOldestLoadedId(channelId)) {
    if (current) {
        notify("已经有一个扫描在进行了");
        return;
    }
    if (!startId) {
        notify("这个频道还没有加载任何消息");
        return;
    }

    // 上次扫到一半的，从断点接着扫
    let from = startId;
    let after = minusOne(startId);
    const partial = getPartialScan(channelId);
    if (partial && compareIds(partial.from, startId) <= 0 && compareIds(startId, partial.to) <= 0) {
        from = partial.from;
        after = partial.to;
    }

    const maxPages = Math.max(1, settings.store.scanMaxPages | 0);
    const state: ScanState = current = { channelId, pages: 0, found: 0, stopRequested: false };
    emitScan();

    let done = false;
    let failed = false;

    try {
        while (state.pages < maxPages && !state.stopRequested) {
            // 已经接上之前确认过的完整区间，后面不用再翻了
            const covered = getCoveredFrom(channelId);
            if (covered && compareIds((BigInt(after) + 1n).toString(), covered) >= 0) {
                done = true;
                break;
            }

            let res: any;
            try {
                res = await RestAPI.get({
                    url: `/channels/${channelId}/messages`,
                    query: { limit: 100, after },
                    retries: 2,
                });
            } catch (e: any) {
                if (e?.status === 429) {
                    const wait = Math.ceil((e.body?.retry_after ?? 5) * 1000);
                    await sleep(wait);
                    continue;
                }
                throw e;
            }

            const messages: any[] = Array.isArray(res?.body) ? res.body : [];
            state.pages++;

            let newest = after;
            for (const m of messages) {
                if (indexMessage(m, channelId)) state.found++;
                if (compareIds(m.id, newest) > 0) newest = m.id;
            }
            after = newest;
            setPartialScan(channelId, { from, to: after });
            emitChange();
            emitScan();

            if (messages.length < 100) {
                done = true;
                break;
            }

            await sleep(Math.max(0, settings.store.scanDelayMs | 0));
        }
    } catch (e) {
        failed = true;
        console.error("[ReplyCount] scan failed", e);
    } finally {
        current = null;
    }

    if (done) {
        setPartialScan(channelId, null);
        extendCoverage(channelId, from);
        emitChange();
        notify(`扫描完成：翻了 ${state.pages} 页，新发现 ${state.found} 条回复`);
    } else if (failed) {
        notify(`扫描出错，已停止（新发现 ${state.found} 条回复）`);
    } else {
        notify(
            state.stopRequested
                ? `已停止：新发现 ${state.found} 条回复，下次扫描会接着往后翻`
                : `已翻 ${state.pages} 页还没到最新，再点一次扫描会接着往后翻`
        );
    }

    emitScan();
}
