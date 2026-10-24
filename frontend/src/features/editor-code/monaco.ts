// Отдельная точка входа Monaco для других фич: импортировать только из лениво загружаемых модулей,
// иначе monaco-editor попадёт в основной чанк (поэтому не реэкспортируется из index.ts).
export { setupMonaco, GRAPHITE_THEME, CODE_FONT } from './monacoSetup';
