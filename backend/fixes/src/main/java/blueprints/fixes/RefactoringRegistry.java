package blueprints.fixes;

import java.util.List;

/** Список фиксов; новый фикс = новый класс + строка в {@link #defaults()}. id фикса — то, что попадает в {@code Issue.fixes}. */
public final class RefactoringRegistry {
    private final List<Refactoring> refactorings;

    public RefactoringRegistry(List<Refactoring> refactorings) {
        this.refactorings = List.copyOf(refactorings);
    }

    public static RefactoringRegistry defaults() {
        return new RefactoringRegistry(List.of(new StringBuilderFix(), new LinkedHashSetFix(), new IndexByIdFix()));
    }

    public List<Refactoring> refactorings() {
        return refactorings;
    }

    /** Фикс по id или null. */
    public Refactoring byId(String id) {
        return refactorings.stream().filter(r -> r.id().equals(id)).findFirst().orElse(null);
    }
}
