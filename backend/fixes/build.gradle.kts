plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    implementation(project(":source"))
    implementation(project(":analysis"))
    implementation(project(":testing"))
}
