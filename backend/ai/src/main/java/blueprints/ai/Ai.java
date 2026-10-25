package blueprints.ai;

import blueprints.fixes.FixProvider;
import blueprints.fixes.Refactoring;
import blueprints.model.Issue;
import com.github.javaparser.ast.body.CallableDeclaration;
import java.util.List;

/**
 * Опциональный ИИ-слой (§14а.10): «объясни метод», правка ноды текстом, фиксы через {@link #fixProviders()}.
 * Без клиента (нет LLM_API_KEY) {@link #available()} = false, вызовы бросают {@link LlmClient.Unavailable}.
 */
public final class Ai {
    public static final List<String> FEATURES = List.of("explain", "fix", "edit-node");
    static final String ORDER_RULE = "Обязательно сохраняй порядок перебора: используй только LinkedHashMap/LinkedHashSet, "
            + "никогда HashMap/HashSet.";
    static final String EXPLAIN = """
            Ты объясняешь метод Java начинающему разработчику. Ответ на русском в Markdown, кратко, три раздела: \
            **Что делает.**, **Сложность.** (Big O по размеру входа), **Побочные эффекты.**""";
    static final String EDIT = """
            Ты правишь метод Java по инструкции пользователя. Меняй только то, что требует инструкция. %s
            Ответ — один блок ```java с полным новым текстом метода (без javadoc). Нужные новые импорты — строками import \
            в начале блока. Без пояснений.""".formatted(ORDER_RULE);

    private final LlmClient client;
    private final List<FixProvider> fixProviders;

    /** client null — ИИ выключен. */
    public Ai(LlmClient client) {
        this.client = client;
        this.fixProviders = client == null ? List.of() : List.of(new LlmFixProvider(client));
    }

    public boolean available() {
        return client != null;
    }

    /** Источники ИИ-фиксов; новый — новый класс + строка в конструкторе. */
    public List<FixProvider> fixProviders() {
        return fixProviders;
    }

    /** Markdown-объяснение метода {@code method} из разбора {@code text}. */
    public String explain(String text, CallableDeclaration<?> method) {
        return client().chat(EXPLAIN, "```java\n" + MethodPatch.slice(text, method) + "\n```");
    }

    /**
     * Новый полный текст файла: метод переписан по инструкции; {@code fragment} — текст выбранной ноды или null (весь метод).
     * Вне метода файл не меняется. @throws MethodPatch.BadReply ответ не разбирается как Java
     */
    public String edit(String text, CallableDeclaration<?> method, String fragment, String instruction) {
        String user = "Метод:\n```java\n" + MethodPatch.slice(text, method) + "\n```\n"
                + (fragment == null ? "" : "Изменить нужно только этот фрагмент метода:\n```java\n" + fragment + "\n```\n")
                + "Инструкция: " + instruction;
        return MethodPatch.apply(text, method, MethodPatch.parse(client().chat(EDIT, user)));
    }

    /** Фикс первого {@link LlmFixProvider} из списка; модель спрашивается сразу. */
    public Refactoring proposeFix(Issue issue, String path, String text, CallableDeclaration<?> method) {
        client();
        for (FixProvider p : fixProviders) if (p instanceof LlmFixProvider l) return l.propose(issue, path, text, method);
        throw new LlmClient.Unavailable("нет источника ИИ-фиксов");
    }

    private LlmClient client() {
        if (client == null) throw new LlmClient.Unavailable("ИИ не настроен: не задан LLM_API_KEY");
        return client;
    }
}
