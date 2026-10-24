# syntax=docker/dockerfile:1
# Контекст сборки — папка backend/. Тесты здесь не гоняются (их гоняет CI).

FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.gradle \
    chmod +x gradlew && ./gradlew :app:bootJar --no-daemon -x test

# Рантайм — JDK, а не JRE: Runner, QualityGate и JavacOutline компилируют в процессе (javax.tools).
# Это тот же образ, что BLUEPRINTS_RUN_IMAGE по умолчанию, поэтому на хосте слои общие.
FROM eclipse-temurin:21-jdk
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /src/app/build/libs/app.jar /app/app.jar

# Запуск под root: доступ к /var/run/docker.sock и так равен root на хосте, а GID группы docker у хостов разный.
ENV BLUEPRINTS_RUN_DIR=/var/lib/blueprints-run \
    BLUEPRINTS_RUN_IMAGE=eclipse-temurin:21-jdk \
    JAVA_OPTS="-XX:MaxRAMPercentage=75"

COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
mkdir -p "$BLUEPRINTS_RUN_DIR"
# образ песочницы скачивается в фоне: сервер стартует сразу, ошибка pull не валит старт
( docker image inspect "$BLUEPRINTS_RUN_IMAGE" >/dev/null 2>&1 \
  || docker pull -q "$BLUEPRINTS_RUN_IMAGE" >/dev/null 2>&1 \
  || echo "blueprints: docker pull $BLUEPRINTS_RUN_IMAGE не удался" >&2 ) &
exec java $JAVA_OPTS -jar /app/app.jar "$@"
EOF
RUN chmod +x /app/entrypoint.sh && mkdir -p /var/lib/blueprints-run

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
