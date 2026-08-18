# Feature Changes
- [x] Allow for specification of book type per book in batch mode
- [x] In progress loading icon for batch
    - [x] Make sure it only loads the data it needs into memory and keeps as much memory as it can free until time to batch and then open images individually.
- [x] Hardcover back cover guess smart?
- [x] Export csv with pngs about what was done and reuploadable to rerun. Stores just cover name and other configuration options.
- [x] Gracefully handle errors (e.g. when it fails give an error and why and how to fix)

# UX/UI Problems
- [ ] Left align batch button on main page.
- [x] Gray out buttons until fully generated
- [ ] Fix scaling colliding with book type selector in batch mode
- [ ] Make design consistent between the two.
- [ ] Make the scrollbars match the asthetic.
- [ ] Make the custom color picker in batch match the one used for single.