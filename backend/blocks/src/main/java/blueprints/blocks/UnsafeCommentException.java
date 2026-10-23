package blueprints.blocks;

/**
 * Новый или изменённый comment-блок содержит \\u-escape: javac раскрывает его (в т.ч. \\u000a — перевод строки) и внутри
 * комментария, поэтому такой текст не генерируется.
 */
public final class UnsafeCommentException extends InvalidNodeException {
    public UnsafeCommentException(String blockId, String text) {
        super(blockId, "Комментарий содержит \\u-escape — уберите его" + (blockId != null ? " (блок " + blockId + ")" : "") + ": " + text);
    }
}
