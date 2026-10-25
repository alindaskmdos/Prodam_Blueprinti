package blueprints.ai;

import blueprints.fixes.FixProvider;
import blueprints.fixes.Refactoring;
import blueprints.model.Issue;
import com.github.javaparser.ast.body.CallableDeclaration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * «Предложи фикс» (§9, §14а.10): модель переписывает метод с проблемой, результат — {@link Refactoring} для того же
 * Quality Gate, что у правил. В промпте — правило порядка перебора; фикс с новыми HashMap/HashSet отклоняется в apply.
 */
public final class LlmFixProvider implements FixProvider {
    public static final String ID = "llm";
    static final String ORDER_VIOLATION =
            "ИИ использовал HashMap/HashSet — порядок перебора не сохраняется, нужен LinkedHashMap/LinkedHashSet";
    static final String SYSTEM = """
            Ты исправляешь проблему производительности или дефект в методе Java, не меняя его наблюдаемого поведения \
            (вывод, возвращаемые значения, исключения, порядок перебора). %s
            Ответ — один блок ```java с полным новым текстом метода (без javadoc). Нужные новые импорты — строками import \
            в начале блока. Сигнатуру не меняй. Без пояснений.""".formatted(Ai.ORDER_RULE);

    private final LlmClient client;

    public LlmFixProvider(LlmClient client) {
        this.client = client;
    }

    @Override
    public String id() {
        return ID;
    }

    /**
     * Спрашивает модель (сразу, {@link LlmClient.Unavailable} — до Quality Gate) и возвращает фикс с target = {@code issue.id()}.
     * {@code method} — из разбора {@code text} файла {@code path}.
     */
    public Refactoring propose(Issue issue, String path, String text, CallableDeclaration<?> method) {
        String old = MethodPatch.slice(text, method);
        String reply = client.chat(SYSTEM, "Проблема " + issue.rule() + ": " + issue.message()
                + (issue.recommendation() == null ? "" : "\nРекомендация: " + issue.recommendation())
                + "\n\nМетод:\n```java\n" + old + "\n```");
        return new Refactoring() {
            @Override
            public String id() {
                return ID;
            }

            /** Файл не менялся с запроса к модели. */
            @Override
            public boolean canApply(Map<String, String> files, String target) {
                return issue.id().equals(target) && text.equals(files.get(path));
            }

            @Override
            public Map<String, String> apply(Map<String, String> files, String target) {
                MethodPatch.Reply r = MethodPatch.parse(reply);
                if (r.hashCollections() > MethodPatch.count(old)) throw new IllegalStateException(ORDER_VIOLATION);
                String patched = MethodPatch.apply(text, method, r);
                if (patched.equals(text)) throw new IllegalStateException("ИИ не предложил изменений");
                Map<String, String> out = new LinkedHashMap<>();
                out.put(path, patched);
                return out;
            }
        };
    }
}
