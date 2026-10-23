package blueprints.fixes;

/** Точка расширения: источник исправлений (правила, позже LLM). Методы добавятся с моделью Issue. */
public interface FixProvider {
    String id();
}
