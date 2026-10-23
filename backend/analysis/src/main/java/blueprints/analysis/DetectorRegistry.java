package blueprints.analysis;

import java.util.ArrayList;
import java.util.List;

/** Список детекторов; новое правило = новый класс + строка в {@link #defaults()}. */
public final class DetectorRegistry {
    private final List<Detector> detectors;

    public DetectorRegistry(List<Detector> detectors) {
        this.detectors = List.copyOf(detectors);
    }

    public static DetectorRegistry defaults() {
        return new DetectorRegistry(new ArrayList<>());
    }

    public List<Detector> detectors() {
        return detectors;
    }
}
