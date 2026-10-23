package blueprints.blocks;

/**
 * Новый или изменённый comment-блок содержит \\u-escape: javac раскрывает его (в т.ч. \\u000a — перевод строки) и внутри
 * комментария, поэтому такой текст не генерируется. В BE-07 — ошибка валидации ноды.
 */
public final class UnsafeCommentException extends IllegalArgumentException {
    private final String blockId;

    public UnsafeCommentException(String blockId, String text) {
        super("Комментарий содержит \\u-escape — уберите его" + (blockId != null ? " (блок " + blockId + ")" : "") + ": " + text);
        this.blockId = blockId;
    }

    /** id блока comment; может быть null у новой ноды без id. */
    public String blockId() {
        return blockId;
    }
}
