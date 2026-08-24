import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  text: string;
  type: ToastType;
}

export type ConfirmMode = 'okCancel' | 'saveDiscardCancel';

export interface ConfirmOptions {
  title: string;
  description?: string;
  mode: ConfirmMode;
  confirmText?: string;
  cancelText?: string;
  discardText?: string;
}

export type ConfirmResult = boolean | 'save' | 'discard' | 'cancel';

interface UiState {
  sidebarSearch: string;
  showAiPanel: boolean;
  toastList: Toast[];
  confirmOptions: ConfirmOptions | null;
  confirmResolver: ((value: ConfirmResult) => void) | null;
  /** 大模型思考过程开关：开 → 实时输出 reasoning；关 → 跳过思考直接出答案 */
  reasoningEnabled: boolean;
  /** AI 面板宽度（px），可拖动调整 */
  aiPanelWidth: number;

  setSidebarSearch: (v: string) => void;
  setShowAiPanel: (v: boolean) => void;
  toggleShowAiPanel: () => void;
  setReasoningEnabled: (v: boolean) => void;
  toggleReasoning: () => void;
  setAiPanelWidth: (w: number) => void;

  pushToast: (toast: Omit<Toast, 'id'>) => void;
  popToast: (id: string) => void;

  openConfirm: (
    options: ConfirmOptions
  ) => Promise<ConfirmResult>;
  closeConfirm: (result: ConfirmResult) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  sidebarSearch: '',
  showAiPanel: false,
  toastList: [],
  confirmOptions: null,
  confirmResolver: null,
  reasoningEnabled: true, // 默认开启思考过程，让用户能看见模型"在想什么"
  aiPanelWidth: 380, // AI 面板默认宽度

  setSidebarSearch: (v) => set({ sidebarSearch: v }),
  setShowAiPanel: (v) => set({ showAiPanel: v }),
  toggleShowAiPanel: () => set({ showAiPanel: !get().showAiPanel }),
  setReasoningEnabled: (v) => set({ reasoningEnabled: v }),
  toggleReasoning: () => set({ reasoningEnabled: !get().reasoningEnabled }),
  setAiPanelWidth: (w) => set({ aiPanelWidth: Math.max(280, Math.min(640, w)) }),

  pushToast: (toast) => {
    const id = `toast_${++toastSeq}_${Date.now()}`;
    set((s) => ({ toastList: [...s.toastList, { ...toast, id }] }));
    setTimeout(() => {
      get().popToast(id);
    }, 1500);
  },
  popToast: (id) =>
    set((s) => ({
      toastList: s.toastList.filter((t) => t.id !== id)
    })),

  openConfirm: (options) => {
    return new Promise<ConfirmResult>((resolve) => {
      set({
        confirmOptions: options,
        confirmResolver: resolve
      });
    });
  },
  closeConfirm: (result) => {
    const resolver = get().confirmResolver;
    set({
      confirmOptions: null,
      confirmResolver: null
    });
    if (resolver) resolver(result);
  }
}));
