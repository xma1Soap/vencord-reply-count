/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 xma1Soap and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import {
    ChannelStore, ContextMenuApi, GuildMemberStore, Menu, NavigationRouter, Popout, SelectedChannelStore,
    useEffect, useRef, UserStore, useState, useStateFromStores
} from "@webpack/common";
import type { ReactNode } from "react";

import { getLastResult, getScanState, scanChannel, stopScan, subscribeScan } from "./scan";
import { settings } from "./settings";
import { clearAll, getReplies, getReplyCount, getStats, isComplete, requestSync, subscribe } from "./store";

/** 频道右上角那一排图标用的组件，自带 tooltip / 悬浮高亮 / 尺寸 */
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------- 小工具 ----------

/** 订阅一个外部数据源，只有 getSnapshot 的结果变了才重新渲染 */
function useExternal<T>(sub: (l: () => void) => () => void, getSnapshot: () => T): T {
    const [value, setValue] = useState(getSnapshot);
    const latest = useRef(getSnapshot);
    latest.current = getSnapshot;

    useEffect(() => {
        const update = () => setValue(latest.current());
        update();
        return sub(update);
    }, [sub]);

    return value;
}

function displayName(authorId: string | undefined, channelId: string) {
    if (!authorId) return "未知用户";
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    const nick = guildId ? GuildMemberStore.getNick(guildId, authorId) : null;
    const user = UserStore.getUser(authorId);
    return nick || (user as any)?.globalName || user?.username || "未知用户";
}

function jumpTo(channelId: string, messageId: string) {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id ?? "@me";
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}/${messageId}`);
}

function snippet(text: string, max = 40) {
    const flat = text.replace(/\s+/g, " ").trim();
    if (!flat) return "（无文字内容）";
    return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function timeOf(id: string) {
    const ms = Number(BigInt(id) >> 22n) + 1420070400000;
    return new Date(ms).toLocaleString();
}

// ---------- 图标 ----------

function ReplyCountIcon({ className, size = 24 }: { className?: string; size?: number; }) {
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"
            />
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 7 8.5 9.5 11 12M8.5 9.5H13a2.5 2.5 0 0 1 2.5 2.5"
            />
        </svg>
    );
}

// ---------- 消息下方的计数 ----------

function openReplyList(event: React.MouseEvent, message: any) {
    ContextMenuApi.openContextMenu(event as any, () => <ReplyListMenu message={message} />);
}

function ReplyListMenu({ message }: { message: any; }) {
    const channelId: string = message.channel_id;
    const replies = getReplies(message.id);
    const complete = isComplete(channelId, message.id);
    const shown = replies.slice(-50);

    return (
        <Menu.Menu navId="vc-replycount-list" onClose={ContextMenuApi.closeContextMenu} aria-label="回复列表">
            <Menu.MenuGroup label={`${replies.length}${complete ? "" : "+"} 条回复 · 点击跳转`}>
                {shown.map(r => (
                    <Menu.MenuItem
                        key={r.id}
                        id={`vc-replycount-${r.id}`}
                        label={`${displayName(r.authorId, r.channelId)}：${snippet(r.content)}`}
                        subtext={timeOf(r.id)}
                        action={() => jumpTo(r.channelId ?? channelId, r.id)}
                    />
                ))}
            </Menu.MenuGroup>
            {replies.length > shown.length && (
                <Menu.MenuItem id="vc-replycount-more" label={`只显示最新 ${shown.length} 条`} disabled />
            )}
            {!complete && (
                <Menu.MenuGroup>
                    <Menu.MenuItem
                        id="vc-replycount-scan-here"
                        label="补全这条消息的计数"
                        subtext="从这条消息往后翻到最新"
                        action={() => scanChannel(channelId, message.id)}
                    />
                </Menu.MenuGroup>
            )}
        </Menu.Menu>
    );
}

function snapshotFor(channelId: string, messageId: string) {
    const count = getReplyCount(messageId);
    return count === 0 ? "0" : `${count}${isComplete(channelId, messageId) ? "" : "+"}`;
}

function ReplyCountBadge({ message }: { message: any; }) {
    const channelId: string = message.channel_id;
    const { minCount } = settings.use(["minCount"]);
    const snap = useExternal(subscribe, () => snapshotFor(channelId, message.id));

    useEffect(() => {
        requestSync(channelId);
    }, [channelId]);

    const count = parseInt(snap, 10);
    if (!count || count < Math.max(1, minCount | 0)) return null;
    const partial = snap.endsWith("+");

    return (
        <div className="vc-replycount-wrap">
            <button
                type="button"
                className="vc-replycount-pill"
                onClick={e => openReplyList(e, message)}
                title={partial
                    ? "这条消息之后的部分消息还没加载过，实际回复可能更多。点击查看已知回复，或从菜单里补全"
                    : "点击查看都有谁回复了"}
            >
                <ReplyCountIcon className="vc-replycount-icon" size={14} />
                <span>{snap} 条回复</span>
            </button>
        </div>
    );
}

export function ReplyCountAccessory({ message }: { message: any; }) {
    const { showCounts } = settings.use(["showCounts"]);
    if (!showCounts || !message?.id || !message.channel_id) return null;
    return <ReplyCountBadge message={message} />;
}

// ---------- 右上角按钮 + 菜单 ----------

function HeaderMenu({ onClose }: { onClose(): void; }) {
    const { showCounts } = settings.use(["showCounts"]);
    const scan = useExternal(subscribeScan, () => {
        const s = getScanState();
        return s ? { ...s } : null;
    });
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const stats = getStats();

    return (
        <Menu.Menu navId="vc-replycount" onClose={onClose} aria-label="回复计数">
            <Menu.MenuCheckboxItem
                id="vc-replycount-toggle"
                label="显示回复计数"
                checked={showCounts}
                action={() => { settings.store.showCounts = !showCounts; }}
            />
            <Menu.MenuSeparator />
            {scan ? (
                <Menu.MenuItem
                    id="vc-replycount-stop"
                    label={scan.stopRequested ? "正在停止…" : "停止扫描"}
                    subtext={`已翻 ${scan.pages} 页，新发现 ${scan.found} 条回复`}
                    disabled={scan.stopRequested}
                    action={stopScan}
                />
            ) : (
                <Menu.MenuItem
                    id="vc-replycount-scan"
                    label="补全当前频道的计数"
                    subtext={getLastResult() ?? "从已加载的最早一条消息往后翻到最新"}
                    disabled={!channelId}
                    action={() => { if (channelId) scanChannel(channelId); }}
                />
            )}
            <Menu.MenuItem
                id="vc-replycount-clear"
                label="清空已统计的数据"
                subtext={`目前记录了 ${stats.replies} 条回复`}
                color="danger"
                disabled={!!scan}
                action={clearAll}
            />
        </Menu.Menu>
    );
}

function HeaderButton() {
    const { showCounts } = settings.use(["showCounts"]);
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => <HeaderMenu onClose={() => setShow(false)} />}
        >
            {(_: any, { isShown }: { isShown: boolean; }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className="vc-replycount-header-btn"
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : `回复计数：${showCounts ? "已开启" : "已关闭"}`}
                    icon={ReplyCountIcon}
                    selected={showCounts || isShown}
                />
            )}
        </Popout>
    );
}

/**
 * 把按钮放到右上角那排图标的最前面。
 * toolbar 为空表示这个页面本来就没有工具栏，保持原样；
 * 有时是数组、有时是单个节点，两种都得接住。返回新数组，不改 Discord 传进来的那个。
 */
export function withHeaderButton(toolbar: ReactNode[] | ReactNode) {
    if (toolbar == null) return toolbar;

    const button = (
        <ErrorBoundary noop key="vc-replycount-header-btn">
            <HeaderButton />
        </ErrorBoundary>
    );

    return Array.isArray(toolbar) ? [button, ...toolbar] : [button, toolbar];
}
