# Feature Changes
- [x] Allow for specification of book type per book in batch mode
- [x] In progress loading icon for batch
    - [x] Make sure it only loads the data it needs into memory and keeps as much memory as it can free until time to batch and then open images individually.
- [x] Hardcover back cover guess smart?
- [x] Export csv with pngs about what was done and reuploadable to rerun. Stores just cover name and other configuration options.
- [x] Gracefully handle errors (e.g. when it fails give an error and why and how to fix)
- [x] When it fails, don't stop generation. Continue going and throw an error with the failed ones at the end.
- [ ] Autodetect color mode problems and warn before it starts
- [ ] Trimming and drop-shadowing that's currently done in Photoshop could be integrated.
- [ ] Remove spiral option from batch mode
- [ ] Any parameter that can be set in single mode.
- [ ] Export hardcover color into csv.
- [ ] Figure out how to generate spirals in the maker itself.
- [ ] Rounded corner.

# UX/UI Problems
- [x] Left align batch button on main page.
- [x] Gray out buttons until fully generated
- [x] Fix scaling colliding with book type selector in batch mode
- [x] Make design consistent between the two.
- [x] Make the scrollbars match the asthetic.
- [x] Make the custom color picker in batch match the one used for single.
