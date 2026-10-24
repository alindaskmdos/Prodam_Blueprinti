import { create } from 'zustand';

/** Видимость экрана загрузки и диалога экспорта (команды project.upload / project.export). */
export interface UploadUiState {
  /** Экран загрузки открыт поверх уже загруженного проекта. Без проекта он показывается всегда. */
  uploadOpen: boolean;
  exportOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
  openExport: () => void;
  closeExport: () => void;
}

export const useUploadUi = create<UploadUiState>()((set) => ({
  uploadOpen: false,
  exportOpen: false,
  openUpload: () => set({ uploadOpen: true, exportOpen: false }),
  closeUpload: () => set({ uploadOpen: false }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
}));

/** Сброс (тесты). */
export function resetUploadUi(): void {
  useUploadUi.setState({ uploadOpen: false, exportOpen: false });
}
