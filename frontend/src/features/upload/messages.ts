import type { Schemas } from '../api';

type ErrorCode = Schemas['Error']['code'];
type WarningCode = Schemas['LoadWarning']['code'];

/** Заголовок и пояснение отказа загрузки по коду Error (ТЗ §11). */
const uploadErrors: Partial<Record<ErrorCode, { title: string; hint: string }>> = {
  NO_SOURCES: { title: 'Нужны исходники', hint: 'В .jar только .class. Загрузите *-sources.jar или папку с .java.' },
  DUPLICATE_FQN: { title: 'Дубликат класса', hint: 'Один и тот же класс объявлен в нескольких файлах.' },
  ZIP_SLIP: { title: 'Небезопасный архив', hint: 'В архиве путь с «..» или абсолютный путь. Архив отклонён целиком.' },
  LIMIT_EXCEEDED: { title: 'Слишком большой проект', hint: 'Больше 20 МБ при распаковке или больше 2000 файлов.' },
  PARSE_ERROR: { title: 'Не удалось разобрать код', hint: 'Исправьте синтаксис и загрузите снова.' },
  INVALID_REQUEST: { title: 'Некорректный запрос', hint: 'Выберите хотя бы один файл .java, .zip или .jar.' },
};

export interface UploadFailure {
  title: string;
  hint: string;
  /** Сообщение сервера (Error.message). */
  message: string | null;
  /** DUPLICATE_FQN: конфликтующие файлы. */
  files: string[];
  /** Индекс шага разбора (UPLOAD_STEPS), на котором отказ. */
  failedStep: number;
}

/** Шаги разбора (подписи — по макету Upload). Бэк отвечает одним запросом, шаги — его этапы по ТЗ §11. */
export const UPLOAD_STEPS = [
  'Отправка файлов',
  'Распаковка, проверка путей',
  'Source root по package',
  'Разбор и анализ',
] as const;

export function describeUploadError(status: number | null, error: Schemas['Error'] | null): UploadFailure {
  if (!error) {
    return {
      title: status === null ? 'Сервер недоступен' : 'Загрузка не удалась',
      hint: status === null ? 'Проверьте, что бэкенд запущен, и попробуйте снова.' : `Ответ сервера: HTTP ${status}.`,
      message: null,
      files: [],
      failedStep: 0,
    };
  }
  const known = uploadErrors[error.code];
  return {
    title: known?.title ?? 'Загрузка не удалась',
    hint: known?.hint ?? '',
    message: error.message,
    files: error.files ?? [],
    failedStep: stepOf(error.code),
  };
}

function stepOf(code: ErrorCode): number {
  switch (code) {
    case 'ZIP_SLIP':
    case 'LIMIT_EXCEEDED':
    case 'NO_SOURCES':
      return 1;
    case 'DUPLICATE_FQN':
      return 2;
    case 'INVALID_REQUEST':
      return 0;
    default:
      return 3;
  }
}

export type WarningTone = 'warn' | 'info' | 'muted';

/** Плашка предупреждения загрузки: текст и вид. */
export function warningBadge(code: WarningCode): { label: string; tone: WarningTone } {
  switch (code) {
    case 'PACKAGE_MISMATCH':
    case 'UNPARSED_FILE':
      return { label: 'внимание', tone: 'warn' };
    case 'TESTS_IMPORTED':
      return { label: 'тесты', tone: 'info' };
    case 'IGNORED_FILE':
      return { label: 'пропущено', tone: 'muted' };
    default:
      // Код, которого нет в текущих типах (бэк новее фронта), — показываем текст как есть.
      return { label: 'внимание', tone: 'muted' };
  }
}
