package blueprints.testing;

/** Контрактный {@code TestStatus}. {@link #wire()} — значение в JSON. */
public enum TestStatus {
    PASSED("passed"),
    FAILED("failed"),
    COMPILE_ERROR("compile_error"),
    /** manual-тест не проходит, и на оригинале тоже — «оригинал тоже не проходит этот тест» (§10.1). */
    ORIGINAL_FAILS("original_fails");

    private final String wire;

    TestStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }
}
