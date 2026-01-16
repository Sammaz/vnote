/**
 * TypeScript type declarations for simple-mind-map library
 */

declare module "simple-mind-map" {
  export interface MindMapNode {
    data: {
      text: string;
      note?: string;
      image?: string;
      imageTitle?: string;
      imageSize?: { width: number; height: number };
      hyperlink?: string;
      hyperlinkTitle?: string;
      tag?: string[];
      generalization?: { text: string }[];
      expand?: boolean;
      isActive?: boolean;
      uid?: string;
      icon?: string[];
      richText?: boolean;
      [key: string]: unknown;
    };
    children?: MindMapNode[];
  }

  export interface MindMapThemeConfig {
    // Background
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundRepeat?: string;
    backgroundPosition?: string;
    backgroundSize?: string;

    // Line
    lineColor?: string;
    lineWidth?: number;
    lineDasharray?: string;
    lineStyle?: string;
    rootLineKeepSameInCurve?: boolean;
    generalizationLineWidth?: number;
    generalizationLineColor?: string;

    // Generalization
    generalizationNodeMargin?: number;
    generalizationNodePadding?: number;

    // Association line
    associativeLineWidth?: number;
    associativeLineColor?: string;
    associativeLineActiveWidth?: number;
    associativeLineActiveColor?: string;
    associativeLineTextColor?: string;
    associativeLineTextFontSize?: number;
    associativeLineTextLineHeight?: number;
    associativeLineTextFontFamily?: string;

    // Root node
    root?: MindMapNodeStyle;

    // Second level node
    second?: MindMapNodeStyle;

    // Third level and below nodes
    node?: MindMapNodeStyle;

    // Generalization node
    generalization?: MindMapNodeStyle;
  }

  export interface MindMapNodeStyle {
    shape?: string;
    fillColor?: string;
    fontFamily?: string;
    color?: string;
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: string;
    lineHeight?: number;
    borderColor?: string;
    borderWidth?: number;
    borderDasharray?: string;
    borderRadius?: number;
    textDecoration?: string;
    gradientStyle?: boolean;
    startColor?: string;
    endColor?: string;
    paddingX?: number;
    paddingY?: number;
  }

  export interface MindMapOptions {
    el: HTMLElement;
    data?: MindMapNode;
    layout?: string;
    theme?: string;
    themeConfig?: MindMapThemeConfig;
    scaleRatio?: number;
    maxTag?: number;
    imgTextMargin?: number;
    textContentMargin?: number;
    selectTranslateStep?: number;
    selectTranslateLimit?: number;
    customNoteContentShow?: {
      show: (content: string, left: number, top: number) => void;
      hide: () => void;
    };
    readonly?: boolean;
    enableFreeDrag?: boolean;
    watermarkConfig?: {
      text?: string;
      lineSpacing?: number;
      textSpacing?: number;
      angle?: number;
      textStyle?: {
        color?: string;
        opacity?: number;
        fontSize?: number;
      };
    };
    textAutoWrapWidth?: number;
    customHandleMousewheel?: (e: WheelEvent) => boolean;
    mousewheelAction?: string;
    mousewheelMoveStep?: number;
    defaultInsertSecondLevelNodeText?: string;
    defaultInsertBelowSecondLevelNodeText?: string;
    expandBtnStyle?: {
      color?: string;
      fill?: string;
      fontSize?: number;
      strokeColor?: string;
    };
    expandBtnIcon?: {
      open?: string;
      close?: string;
    };
    expandBtnNumHandler?: (num: number) => string;
    isShowExpandNum?: boolean;
    enableShortcutOnlyWhenMouseInSvg?: boolean;
    initRootNodePosition?: [string | number, string | number];
    exportPaddingX?: number;
    exportPaddingY?: number;
    nodeTextEditZIndex?: number;
    nodeNoteTooltipZIndex?: number;
    isEndNodeTextEditOnClickOuter?: boolean;
    maxHistoryCount?: number;
    alwaysShowExpandBtn?: boolean;
    iconList?: Array<{ type: string; name: string; list: Array<{ name: string; icon: string }> }>;
    maxNodeCacheCount?: number;
    defaultAssociativeLineText?: string;
    fitPadding?: number;
    enableCtrlKeyNodeSelection?: boolean;
    useLeftKeySelectionRightKeyDrag?: boolean;
    beforeTextEdit?: (node: unknown) => boolean;
    isUseCustomNodeContent?: boolean;
    customCreateNodeContent?: (node: unknown) => HTMLElement | null;
    mouseScaleCenterUseMousePosition?: boolean;
    customInnerElsAppendTo?: HTMLElement | null;
    enableCreateHiddenInput?: boolean;
    enableAutoEnterTextEditWhenKeydown?: boolean;
    customHandleClipboardText?: (text: string) => string;
    disableMouseWheelZoom?: boolean;
    errorHandler?: (code: string, error: Error) => void;
    resetCss?: string;
    enableDblclickBackToRootNode?: boolean;
    minExportImgCanvasScale?: number;
    hoverRectColor?: string;
    hoverRectPadding?: number;
    selectTextOnEnterEditText?: boolean;
    deleteNodeActive?: boolean;
    autoMoveWhenMouseInEdgeOnDrag?: boolean;
    fit?: boolean;
    dragMultiNodeRectConfig?: {
      width?: number;
      height?: number;
      fill?: string;
    };
    dragPlaceholderRectFill?: string;
    dragOpacityConfig?: {
      cloneNodeOpacity?: number;
      beingDragNodeOpacity?: number;
    };
    tagsColorMap?: Record<string, string>;
    cooperateStyle?: {
      avatarSize?: number;
      fontSize?: number;
    };
    associativeLineIsAlwaysAboveNode?: boolean;
    defaultGeneralizationText?: string;
    handleIsSplitByWrapOnPasteRecursively?: boolean;
    addHistoryTime?: number;
    isDisableDrag?: boolean;
    highlightNodeBoxStyle?: {
      stroke?: string;
      fill?: string;
    };
    createNewNodeBehavior?: string;
    defaultNodeImage?: string;
    isLimitMindMapInCanvas?: boolean;
    isLimitMindMapInCanvasWhenHasScrollbar?: boolean;
    nodeRichTextEditZIndex?: number;
    customCheckIsTouchDevice?: () => boolean;
    handleNodePasteImg?: (imgFile: File) => Promise<{ url: string; size: { width: number; height: number } }>;
    enableDragImgToAddNode?: boolean;
    enableEditNodeOnClick?: boolean;
  }

  export interface MindMapView {
    translateX: number;
    translateY: number;
    scale: number;
    setTransform: (x: number, y: number, scale: number) => void;
    transform: (ox: number, oy: number, scale: number) => void;
    reset: () => void;
  }

  export default class MindMap {
    constructor(options: MindMapOptions);

    el: HTMLElement;
    view: MindMapView;

    // Methods
    render(callback?: () => void): void;
    reRender(callback?: () => void): void;
    resize(): void;
    setData(data: MindMapNode): void;
    getData(withConfig?: boolean): MindMapNode;
    export(type: string, isDownload?: boolean, fileName?: string, ...args: unknown[]): Promise<unknown>;
    setTheme(theme: string, notRender?: boolean): void;
    getTheme(): string;
    setThemeConfig(config: MindMapThemeConfig, notRender?: boolean): void;
    getThemeConfig(): MindMapThemeConfig;
    getCustomThemeConfig(): MindMapThemeConfig;
    setLayout(layout: string, notRender?: boolean): void;
    getLayout(): string;
    execCommand(name: string, ...args: unknown[]): void;
    setMode(mode: string): void;
    getMode(): string;
    on(event: string, callback: (...args: unknown[]) => void): void;
    off(event: string, callback?: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
    toPos(x: number, y: number): { x: number; y: number };
    addPlugin(plugin: unknown, opt?: unknown): void;
    removePlugin(plugin: unknown): void;
    initPlugin(plugin: unknown): void;
    destroy(): void;
  }
}
