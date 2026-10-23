package blueprints.blocks;

/** Текст ноды не проходит проверку (§5): нода красная, в код изменение не попадает. blockId — id ноды или её позиция. */
public class InvalidNodeException extends IllegalArgumentException {
    private final String blockId;

    public InvalidNodeException(String blockId, String message) {
        super(message);
        this.blockId = blockId;
    }

    /** id ноды; у новой ноды без id — позиционный ({@code <id родителя>/<слот>/<i>}), может быть null. */
    public String blockId() {
        return blockId;
    }
}
