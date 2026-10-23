# source

Загрузка исходников проекта (ТЗ §11) и дерево проекта. Без Spring; JavaParser отдаётся как `api`.

- `ProjectLoader.load(List<Upload>)` — .java/.zip/.jar: zip slip (`..`, абсолютные пути) и zip bomb (20 МБ / 2000 файлов, считается по мере чтения) -> `LoadException(code)`; имена в архиве не в UTF-8 -> INVALID_REQUEST; общая верхняя папка отрезается в `LoadedProject.root` (`"demo/"` или `""`); пакет из `package`, сверяется с `root + path`; `PACKAGE_MISMATCH` как предупреждение; дубликаты FQN (`LoadException.files()` — конфликтующие файлы), jar без .java, синтаксическая ошибка -> отказ. Результат — `LoadedProject` (root, файлы с исходными байтами, предупреждения, сырые `tests/*.{java,json,in,out}`, main-классы).
- `TreeBuilder.build` — пакеты -> файлы -> классы (вложенные как `Outer$Inner`) -> поля/конструкторы/методы. Id метода: `FQN.имя~N` (N — индекс перегрузки с 0), конструктор — `FQN.<init>~N`. complexity пока null, issueCount 0.
- `ProjectExporter.zip` — исходная структура (`root + path`), байты как загружены; `includeSettings` добавляет `tests/`.

Зависит от: model. Тесты: `./gradlew :source:test` (в т.ч. загрузка `samples/demo`).
