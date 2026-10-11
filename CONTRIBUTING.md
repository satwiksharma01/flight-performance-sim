# Contributing

Use Node.js 22. Start with the [design notes](README.md#design-notes), the [validation dataset](src/data/validation/) and the documented model limits.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

For physics or reference-data changes, also install Python 3.13 and SciPy (`python -m pip install scipy`) and run `npm run validate`. CI runs this independent cross-check before publishing the site.

Explain the equation or behavior being changed and cite the reference, including units and operating conditions. Distinguish a calibration figure from an independent check. Add a focused regression case; preserve known-discrepancy tests rather than loosening them to make the model appear accurate.

Keep SI units inside the physics layer and conversions at the boundary. Preserve preset IDs and permalink compatibility. For UI changes, provide a reproducible scenario link and before/after screenshots, including narrow-screen and keyboard behavior where relevant.

This repository currently has no reuse license. A contribution guide does not grant reuse or redistribution rights; clarify intended terms with the owner before contributing substantial code.
