# ShiftPro Android / Google Play preparation

This repository is `SHIFTPRO22`. Android preparation must be applied to this repository and must not be fetched from the older `SHIFTPROO` project.

## Current working branch

Use the isolated branch:

`android/google-play-prep`

Branch URL: https://github.com/anamiir2-collab/SHIFTPRO22/tree/android/google-play-prep

The main branch is not changed by the Android preparation work. Do not apply an old patch or import an old git bundle from another repository. The previous `shiftpro-release-play-production.bundle` and `0001-release-prepare-ShiftPro-for-Google-Play-prod.patch` were generated for the old repository and are intentionally not used here.

## Planned build process

1. Preserve the existing static PWA files and application behavior.
2. Configure Capacitor for the current project structure.
3. Prepare a web-assets directory that includes the app's required HTML, CSS, JavaScript, locales, images, manifest, and privacy policy.
4. Run the existing test suite.
5. Build Android artifacts with GitHub Actions and inspect the workflow result.
6. Test the Android app on a device before preparing a Play release.

## Important signing and publishing notes

- Never commit a keystore, passwords, signing keys, or other credentials to the repository.
- A debug APK is for testing and is not the production upload artifact.
- A release AAB must be signed before it can be uploaded to Google Play.
- Configure signing values only as GitHub Actions repository secrets after the build pipeline is verified.
- Google Play account-specific testing requirements must be checked in Play Console; do not rely on an old tester count written in archived release notes.

## What to do

No manual patch or bundle application is required. Review changes on the branch above. Keep all work on this branch until the Android build and device checks pass, then open a pull request to merge into `main`.
