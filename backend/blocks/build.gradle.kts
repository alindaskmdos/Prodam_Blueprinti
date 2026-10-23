plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    implementation(project(":source"))
    testImplementation(libs.jackson.databind)
}
