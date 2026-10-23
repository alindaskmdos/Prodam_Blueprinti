package blueprints.testing;

import blueprints.runner.Runner;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Общий пакет запусков одного прогона проверки — потом один {@link Runner#runBatch} (один контейнер).
 * Источники тестов добавляют сюда свои программы, запуски и монтируемые файлы ({@link TestSource#prepare}).
 */
public final class Batch {
    private final List<Runner.Program> programs = new ArrayList<>();
    private final List<Runner.Job> jobs = new ArrayList<>();
    private final Map<String, Path> files = new LinkedHashMap<>();

    /** Индекс, который получит следующая добавленная программа. */
    public int nextProgram() {
        return programs.size();
    }

    /** Добавляет программу, возвращает её индекс (для {@link Runner.Job#program()}). */
    public int addProgram(Runner.Program p) {
        programs.add(p);
        return programs.size() - 1;
    }

    /** Добавляет запуск, возвращает его индекс в результатах пакета. */
    public int addJob(Runner.Job j) {
        if (j.program() < 0 || j.program() >= programs.size()) {
            throw new IllegalArgumentException("Нет программы с индексом " + j.program());
        }
        jobs.add(j);
        return jobs.size() - 1;
    }

    /** Файл для монтирования; один и тот же путь в контейнере — только с тем же файлом. */
    public void addFile(String containerPath, Path file) {
        Path old = files.putIfAbsent(containerPath, file);
        if (old != null && !old.equals(file)) {
            throw new IllegalArgumentException("Путь " + containerPath + " уже занят файлом " + old);
        }
    }

    public List<Runner.Program> programs() {
        return Collections.unmodifiableList(programs);
    }

    public List<Runner.Job> jobs() {
        return Collections.unmodifiableList(jobs);
    }

    public Map<String, Path> files() {
        return Collections.unmodifiableMap(files);
    }
}
