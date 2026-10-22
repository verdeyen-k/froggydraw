# Froggy Draw

A pixel-art copying game for 2 to 8 players. Everyone sits around a 3×3 board: the picture to copy is in the middle,
and the eight spots around it show each player's drawing live. Copy the picture on your own 16×16 grid before time runs out.

Scoring for each round:

- Same color in a spot the picture fills: 1 point.
- Any other color in a spot the picture fills: ½ point.
- Spots that are empty in both the picture and your drawing don't count.

Your round score is the percentage of points you got. The highest total after the last round wins.

Pictures: pencil, buff frog, ruler, ice cream, snowball, flower, storm cloud, cloud, snowflake, donut, bouncy ball,
Pac-Man, Pac-Man ghosts, cactus, spring tree, fall tree, winter tree, dog, cat, chicken, turtle, bread, diamond, CD, dino.

## Playing

- **Create a room**, then friends join with the 4-letter code. Each player picks a color: red, orange, yellow,
  green, turquoise, blue, purple or pink. The host chooses the number of rounds and the time per round.
- **Practice alone**: pick a picture (or 🎲 Surprise me) and copy it with no timer and check your score.
- Tools: ✏️ pen (tap or drag), 🪣 fill, 🧽 eraser, ↩️ undo, 🗑️ clear. Press and hold the picture in the middle to see it bigger.
- Tap ✅ Done when you're finished. The round ends when everyone is done or the time runs out.

The host's device keeps the time and does the scoring, so the host should keep the game open. If the host leaves, the room closes.

## Files

- `index.html`: screens and styles.
- `froggy.js`: drawing, scoring, and the online rooms (Firebase Realtime Database, `froggydraw/rooms/<CODE>` in the `kvgames` project).
- `pictures.js`: the 16×16 pictures and the paint colors.

To run it locally, serve the folder with any static file server, for example `python3 -m http.server`.
