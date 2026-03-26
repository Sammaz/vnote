declare module "react-syntax-highlighter" {
  import type { ComponentType, ReactNode } from "react";

  export interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, unknown>;
    customStyle?: Record<string, unknown>;
    children?: ReactNode;
    PreTag?: keyof JSX.IntrinsicElements | ComponentType<any>;
    CodeTag?: keyof JSX.IntrinsicElements | ComponentType<any>;
    wrapLongLines?: boolean;
    showLineNumbers?: boolean;
    [key: string]: unknown;
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: Record<string, unknown>;
  export const oneLight: Record<string, unknown>;
}
