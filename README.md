# 3D Book Maker
This is a utility built to take flat images of books and generate them in 3D. Currently, hardcover, perfect bound, and saddlestitched books can be generated. The utility can be found at [kinetikeith.github.io/book-maker](https://kinetikeith.github.io/book-maker/).
## Options
When the utility is opened a placeholder book will be generated. You can adjust the book type, insert the needed cover files, and adjust the scaling. If the book is hardcover you can also choose the color of the inside wrap on the back cover. The "Download Image" option allows you to download the file directly to your computer as a png. Copy image copies the png to your clipboard for use in other programs.
The utility accepts pngs, jpegs, and psds (psd implementation is kinda jank though so watch out)
### Perfect Bound
To generate a perfect bound book, insert your cover and spine files and wait for you image to fully generate.
### Hardcover
To generate a hardcover book, insert your cover and spine files and pick the color for the back cover wrap, then wait for you image to fully generate.
### Saddlestitch
To generate a saddlestitched book, insert your cover file and wait for you image to fully generate.
### Spiral Bound
To generate a spiral bound book, insert your cover file, adjust the spine width and wait for the image to fully generate.
## Batch Mode
Click "Batch Mode" on the main page to generate many books in one pass. Drop in as many cover files as you like, and (for perfect bound or hardcover books) drop your spine files into the separate spines box. Covers and spines are paired up automatically by matching their filenames, so exact naming isn't required — each pairing shows a match confidence, and you can override any pairing by hand from its dropdown.
### Setting Book Types
Choose a default book type, which is applied to every new cover you add. Each book in the list can also be switched to its own type individually, overriding the default. Hardcover books get their back cover wrap color guessed automatically from the cover art; click the color swatch next to a row to override it manually if the guess is wrong.
### Spine Type CSV
Instead of setting every book's type by hand, you can upload a CSV with the book name in column A and the spine type (Perfect bound, Hardcover, Saddlestitch, or Spiral bound) in column B. Book names are fuzzy-matched to your uploaded covers, so the CSV doesn't need exact filenames, and a header row is detected automatically and skipped.
### Running a Batch
Once your books are ready — each one either doesn't need a spine, or has a spine matched to it, with hardcover back colors resolved — click "Start Batch" to generate them one at a time. When finished, a `book-maker-batch.zip` downloads containing a PNG for every book plus a `book-maker-batch.csv` recording each book's type. Re-upload that CSV on a future batch (as the Spine Type CSV above) to redo the same run without resetting every book type by hand. If an image fails to load partway through, the batch stops and tells you which file caused the problem.
