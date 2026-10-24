# source

Загрузка исходников проекта (ТЗ §11) и дерево проекта. Без Spring; JavaParser отдаётся как `api`.

- `ProjectLoader.load(List<Upload>)` — .java/.zip/.jar: zip slip (`..`, абсолютные пути) и zip bomb (20 МБ / 2000 файлов, считается по мере чтения) -> `LoadException(code)`; имена в архиве не в UTF-8 -> INVALID_REQUEST; общая верхняя папка отрезается в `LoadedProject.root` (`"demo/"` или `""`); пакет из `package`, сверяется с `root + path`; `PACKAGE_MISMATCH` как предупреждение; дубликаты FQN (`LoadException.files()` — конфликтующие файлы), jar без .java, синтаксическая ошибка -> отказ (`PARSE_ERROR`); если JavaParser не разбирает файл, а javac разбирает (локальные enum/interface — пробел JavaParser 3.26–3.28), файл грузится как текст: предупреждение `UNPARSED_FILE`, пакет/FQN/main — из `JavacOutline` (javac, только parse), в `TreeBuilder` у него нет классов. Результат — `LoadedProject` (root, файлы с исходными байтами, предупреждения, сырые `tests/*.{java,json,in,out}`, main-классы).
- `TreeBuilder.build` — пакеты -> файлы -> классы (вложенные как `Outer$Inner`) -> поля/конструкторы/методы. Id метода: `FQN.имя~N` (N — индекс перегрузки с 0), конструктор — `FQN.<init>~N`. complexity пока null, issueCount 0 (`Method.withAnalysis`).
  Поля форм FE-10 (CT-02): у класса fqn (через точки), headerSpan, headerStart/headerEnd (`Pos` line/column с 1, column в UTF-16 —
  так считает JavaParser), annotations (текст как в коде), modifiers, typeParams, extendsText, implementsTypes; у поля span (у
  компонент record — null); у метода span, header*, modifiers, typeParams, returnType (у конструктора null), params (varargs `T...`), thrown.
  headerStart — первая аннотация/модификатор (javadoc не входит), headerEnd — «{» тела (у класса — первая «{» вне скобок), у метода без тела — «;».
  Имена-ключевые слова (extends/implements/throws) переименовывает app.
- `ProjectExporter.zip` — исходная структура (`root + path`), байты как загружены; `includeSettings` добавляет `tests/`.

Зависит от: model. Тесты: `./gradlew :source:test` (в т.ч. загрузка `samples/demo`).
