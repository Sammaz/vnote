/**
 * Simple Mind Map 主题配置
 * 定义亮色和暗色主题样式
 */

import type { MindMapThemeConfig } from "simple-mind-map";

/**
 * 获取亮色主题配置
 */
export function getLightTheme(): MindMapThemeConfig {
  return {
    // 背景 - 透明以显示容器的点状背景
    backgroundColor: "transparent",

    // 连线
    lineColor: "#94a3b8",
    lineWidth: 2,
    lineStyle: "curve",

    // 根节点
    root: {
      shape: "roundedRectangle",
      fillColor: "#3b82f6",
      color: "#ffffff",
      fontSize: 18,
      fontWeight: "bold",
      borderColor: "#2563eb",
      borderWidth: 2,
      borderRadius: 8,
      paddingX: 20,
      paddingY: 12,
    },

    // 二级节点
    second: {
      shape: "roundedRectangle",
      fillColor: "#eff6ff",
      color: "#1e40af",
      fontSize: 14,
      fontWeight: "500",
      borderColor: "#93c5fd",
      borderWidth: 1,
      borderRadius: 6,
      paddingX: 14,
      paddingY: 8,
    },

    // 三级及以下节点
    node: {
      shape: "roundedRectangle",
      fillColor: "#f8fafc",
      color: "#334155",
      fontSize: 13,
      fontWeight: "normal",
      borderColor: "#cbd5e1",
      borderWidth: 1,
      borderRadius: 4,
      paddingX: 12,
      paddingY: 6,
    },

    // 概要节点
    generalization: {
      shape: "roundedRectangle",
      fillColor: "#fef3c7",
      color: "#92400e",
      fontSize: 12,
      fontWeight: "normal",
      borderColor: "#fcd34d",
      borderWidth: 1,
      borderRadius: 4,
      paddingX: 10,
      paddingY: 4,
    },

    // 概要连线
    generalizationLineWidth: 1,
    generalizationLineColor: "#fbbf24",
  };
}

/**
 * 获取暗色主题配置
 */
export function getDarkTheme(): MindMapThemeConfig {
  return {
    // 背景 - 透明以显示容器的点状背景
    backgroundColor: "transparent",

    // 连线
    lineColor: "#64748b",
    lineWidth: 2,
    lineStyle: "curve",

    // 根节点
    root: {
      shape: "roundedRectangle",
      fillColor: "#3b82f6",
      color: "#ffffff",
      fontSize: 18,
      fontWeight: "bold",
      borderColor: "#60a5fa",
      borderWidth: 2,
      borderRadius: 8,
      paddingX: 20,
      paddingY: 12,
    },

    // 二级节点
    second: {
      shape: "roundedRectangle",
      fillColor: "#1e3a5f",
      color: "#93c5fd",
      fontSize: 14,
      fontWeight: "500",
      borderColor: "#3b82f6",
      borderWidth: 1,
      borderRadius: 6,
      paddingX: 14,
      paddingY: 8,
    },

    // 三级及以下节点
    node: {
      shape: "roundedRectangle",
      fillColor: "#1e293b",
      color: "#cbd5e1",
      fontSize: 13,
      fontWeight: "normal",
      borderColor: "#475569",
      borderWidth: 1,
      borderRadius: 4,
      paddingX: 12,
      paddingY: 6,
    },

    // 概要节点
    generalization: {
      shape: "roundedRectangle",
      fillColor: "#422006",
      color: "#fcd34d",
      fontSize: 12,
      fontWeight: "normal",
      borderColor: "#b45309",
      borderWidth: 1,
      borderRadius: 4,
      paddingX: 10,
      paddingY: 4,
    },

    // 概要连线
    generalizationLineWidth: 1,
    generalizationLineColor: "#b45309",
  };
}
