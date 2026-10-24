import { createElement, type ComponentType } from 'react';
import { PanelStub } from './PanelStub';

/** Компонент-заглушка для реестра вкладок (`panels.ts`). */
export function stubPanel(text: string): ComponentType {
  const Stub = () => createElement(PanelStub, { text });
  Stub.displayName = 'StubPanel';
  return Stub;
}
