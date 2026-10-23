plugins { `java-library` }

val libs = extensions.getByType<VersionCatalogsExtension>().named("libs")

java.toolchain.languageVersion.set(JavaLanguageVersion.of(21))

repositories { mavenCentral() }

dependencies {
    testImplementation(platform(libs.findLibrary("junit-bom").get()))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> { useJUnitPlatform() }
