# Feature Changes
- [ ] Allow for specification of book type per book in batch mode
- [ ] In progress loading icon for batch
    - [ ] Make sure it only loads the data it needs into memory and keeps as much memory as it can free until time to batch and then open images individually.
- [ ] Hardcover back cover guess smart?
- [ ] Export csv with pngs about what was done and reuploadable to rerun. Stores just cover name and other configuration options.
- [ ] Gracefully handle errors (e.g. when it fails give an error and why and how to fix)

# UX/UI Problems
- [ ] Left align batch button on main page.
- [ ] Gray out buttons until fully generated
- [ ] Fix scaling colliding with book type selector in batch mode
- [ ] Make design consistent between the two.