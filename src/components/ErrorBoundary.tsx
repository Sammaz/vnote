/**
 * ErrorBoundary - 全局错误边界组件
 * 捕获 React 组件树中的 JavaScript 错误，防止整个应用崩溃
 */
import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function ErrorFallback({ error, errorInfo, onRetry, onGoHome, onReload }: {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
  onGoHome: () => void;
  onReload: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-8 dark:bg-vnote-card">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg dark:bg-vnote-card">
        {/* 错误图标 */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
          </div>
        </div>

        {/* 错误标题 */}
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">
          应用出现错误
        </h1>

        {/* 错误描述 */}
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          抱歉，应用遇到了一个意外错误。请尝试刷新页面或返回首页。
        </p>

        {/* 错误详情（开发模式） */}
        {import.meta.env.DEV && error && (
          <div className="mb-6 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-left overflow-auto max-h-40">
            <p className="text-sm font-mono text-red-600 dark:text-red-400 break-all">
              {error.message}
            </p>
            {errorInfo && (
              <pre className="text-xs font-mono text-slate-500 dark:text-slate-500 mt-2 whitespace-pre-wrap">
                {errorInfo.componentStack?.slice(0, 500)}
              </pre>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw size={16} />
            重试
          </button>
          <button
            onClick={onGoHome}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <Home size={16} />
            返回首页
          </button>
        </div>

        {/* 刷新提示 */}
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-500">
          如果问题持续存在，请
          <button
            onClick={onReload}
            className="text-blue-500 hover:text-blue-600 dark:text-blue-400 underline ml-1"
          >
            刷新页面
          </button>
        </p>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // 记录错误日志
    console.error("[ErrorBoundary] 捕获到错误:", error);
    console.error("[ErrorBoundary] 组件堆栈:", errorInfo.componentStack);

    // TODO: 可以在这里添加错误上报服务
    // reportErrorToService(error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // 尝试导航到首页
    window.location.hash = "";
  };

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 使用函数式组件渲染错误页面（以便使用 hooks）
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
          onGoHome={this.handleGoHome}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
