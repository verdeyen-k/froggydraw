# Froggy Draw

A pixel-art copying game for 2 to 12 players. Everyone sits around the board: the picture to copy is in the middle,
and the spots around it show each player's drawing live. Up to 8 players use a 3×3 board; 9 to 12 use a 4×4 board
with the picture across the middle four squares. Copy the picture on your own 16×16 grid before time runs out.

Scoring for each round:

- Same color in a spot the picture fills: 1 point.
- Any other color in a spot the picture fills: ½ point.
- Spots that are empty in both the picture and your drawing don't count.

Your round score is the percentage of points you got. The highest total after the last round wins.

Pictures: pencil, buff frog, ruler, ice cream, snowball, flower, storm cloud, cloud, snowflake, donut, bouncy ball,
Pac-Man, Pac-Man ghosts, cactus, spring tree, fall tree, winter tree, dog, cat, chicken, turtle, bread, diamond, CD, dino, pizza, rocket, shooting star, rainbow, hard hat.

## Playing

- **Create a room**, then friends join with the 4-letter code. Each player picks a frog: red angry, orange confused,
  yellow happy, green grossed out, turquoise aqua, blue sad, purple dark sorcerer, pink heart-eyes,
  maroon demon, grey mechanic, black ink or white angel.
  While you wait you can chat; tap a frog face to put that frog in your message as an emoji. The host chooses the number of rounds and the time per round.
- **Practice alone**: pick a picture (or 🎲 Surprise me) and copy it with no timer and check your score.
- **🌈 Color Craze**: turn it on in the room (host) or on the practice picture page. Every color in the picture swaps for a different one, so the frog might be purple with orange eyes. Copy the colors you see.
- Tools: ✏️ pen (tap or drag), 🪣 fill, 🧽 eraser, ↩️ undo, 🗑️ clear. Press and hold the picture in the middle to see it bigger.
- Tap ✅ Done when you're finished. The round ends when everyone is done or the time runs out.

Sound effects are made in the browser (no sound files); 🔊 on the menu or during a round turns them off.

The host's device keeps the time and does the scoring, so the host should keep the game open. If the host leaves, the room closes.

## Files

- `index.html`: screens and styles.
- `froggy.js`: drawing, scoring, and the online rooms (Firebase Realtime Database, `froggydraw/rooms/<CODE>` in the `kvgames` project).
- `pictures.js`: the 16×16 pictures and the paint colors.
- `frogs.js`: the twelve player frogs.

To run it locally, serve the folder with any static file server, for example `python3 -m http.server`.
