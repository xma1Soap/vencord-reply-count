/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 xma1Soap and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import definePlugin from "@utils/types";
import { SelectedChannelStore } from "@webpack/common";

import { ReplyCountAccessory, withHeaderButton } from "./components";
import { settings } from "./settings";
import { emitChange, indexMessage, removeMessage, requestSync } from "./store";

export default definePlugin({
    name: "ReplyCount",
    description: "在每条消息下面显示它总共被回复了多少次，点一下就能看到都有谁回复、跳转过去。频道右上角有开关按钮。",
    authors: [{ name: "xma1Soap", id: 0n }],
    dependencies: ["MessageAccessoriesAPI"],
    settings,

    patches: [
        {
            // 频道右上角那排图标（置顶、收件箱、搜索…）
            find: /toolbar:\i,mobileToolbar:\i/,
            predicate: () => settings.store.showHeaderButton,
            replacement: {
                // 组件开头是 let{…,toolbar:c,mobileToolbar:f,…}=e;
                // 在这句解构之后改局部变量 c，而不是像别的插件那样插在函数开头——
                // 那些插件用 .{1,200} 定位 toolbar，函数开头多插一段会把它们挤得匹配不上
                match: /toolbar:(\i),mobileToolbar:\i,[^}]{0,400}}=\i;/,
                replace: "$&$1=$self.withHeaderButton($1);"
            }
        }
    ],

    withHeaderButton,

    renderMessageAccessory: props => <ReplyCountAccessory message={props.message} />,

    flux: {
        MESSAGE_CREATE({ message, channelId, optimistic }: any) {
            if (optimistic) return;
            if (indexMessage(message, channelId)) emitChange();
        },
        MESSAGE_UPDATE({ message }: any) {
            if (indexMessage(message)) emitChange();
        },
        MESSAGE_DELETE({ id }: any) {
            if (removeMessage(id)) emitChange();
        },
        MESSAGE_DELETE_BULK({ ids }: any) {
            let changed = false;
            for (const id of ids ?? []) {
                if (removeMessage(id)) changed = true;
            }
            if (changed) emitChange();
        },
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: any) {
            let changed = false;
            for (const m of messages ?? []) {
                if (indexMessage(m, channelId)) changed = true;
            }
            if (changed) emitChange();
            // 等 Discord 自己的消息缓存更新完再看这段是否连到了最新
            requestSync(channelId);
        },
        CHANNEL_SELECT({ channelId }: any) {
            if (channelId) requestSync(channelId);
        },
    },

    start() {
        const channelId = SelectedChannelStore.getChannelId();
        if (channelId) requestSync(channelId);
    },
});
