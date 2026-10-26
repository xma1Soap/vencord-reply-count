/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 xma1Soap and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    // 不能叫 enabled：那个键是 Vencord 用来记录插件本身开关的
    showCounts: {
        type: OptionType.BOOLEAN,
        description: "在消息下方显示被回复次数（也可以用频道右上角的按钮开关）",
        default: true,
    },
    minCount: {
        type: OptionType.NUMBER,
        description: "被回复至少这么多次才显示",
        default: 1,
    },
    showHeaderButton: {
        type: OptionType.BOOLEAN,
        description: "在频道右上角显示开关按钮（改动后需要 Ctrl+R 刷新）",
        default: true,
        restartNeeded: true,
    },
    scanMaxPages: {
        type: OptionType.NUMBER,
        description: "手动扫描时一次最多翻多少页（每页 100 条消息）",
        default: 30,
    },
    scanDelayMs: {
        type: OptionType.NUMBER,
        description: "手动扫描时每页之间等待的毫秒数（太快可能被 Discord 限流）",
        default: 600,
    },
});
