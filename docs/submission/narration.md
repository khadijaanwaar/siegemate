# Siegemate demo film: narration draft

A draft for a 90 to 120 second film cut from emulator footage (Lane D harness: Playwright + IWER, scripted hands, a
photographed room behind passthrough). Voice: a warm female narrator, Fish Audio S2, emotion tags in square brackets
at the start of a sentence, at most two per line. Pauses are not written in: gaps are cut in the edit. Pace about 145
words a minute; the script is 198 spoken words, about 82 seconds of speech, so the film runs about 110 s with the gaps.

Every shot carries the persistent corner label **"Emulator capture · simulated room"** (bottom left, the whole film).
Never say or show anything about a real headset or frame rates on a device.

Times are targets for the cut; adjust to the footage.

---

## Beat 1: enter mixed reality, the board settles (0:00 to 0:14)

**Shot:** "Play on your table" pressed in the Quest browser page; passthrough of the room; the placement ring finds the
table; a pinch; the board appears and the armies stand up in their idle poses.

**Narration:**
- [warm] This is Siegemate. Chess, on your own table.
- Open it in the Quest browser, look at a table, and pinch.
- [hushed] Two armies stand up on the wood, waiting for orders.

**On-screen caption:** Open siegemate.pages.dev · Pinch to place

## Beat 2: pinch and carry e2 to e4, the computer replies (0:14 to 0:30)

**Shot:** The right hand pinches the e2 pawn; its squares light; the green order line runs to the fingers; release over
e4; the pawn walks there. The computer answers e7 to e5 and its figure marches.

**Narration:**
- [confident] Pinch a soldier. Its squares light up.
- Carry the order to a glowing square and let go.
- He marches there on his own legs.
- [warm] And the computer answers.

**On-screen caption:** Pinch a figure · let go on a lit square

## Beat 3: a capture fight (0:30 to 0:44)

**Shot:** Close on a capture at figure height: the attacker strikes on the hit frame, sparks, the defender burns away
from the feet up; then the victor takes the square.

**Narration:**
- [excited] Every capture is a fight.
- Blades, spells, musket fire.
- [hushed] And the loser burns away.

**On-screen caption:** Three armies: Ivory Kingdom · Sun Empire · Grande Armée

## Beat 4: the promotion card (0:44 to 0:54)

**Shot:** A pawn reaches the last rank; the Queen, Rook, Bishop, Knight card appears on the player's edge; a fingertip
pokes Queen; the pawn is crowned.

**Narration:**
- Reach the last rank and a card appears at your side.
- [warm] Poke a queen, and she takes the field.

**On-screen caption:** Poke to crown

## Beat 5: a battleground change restyles the room (0:54 to 1:12)

**Shot:** The menu's Battleground button pressed; the room crossfades from Dawn Court to Frostfall (snow in the room,
cool veil), then to Siege at Dusk (room dimmed deep orange, embers rising beside the board, warm light on the table).

**Narration:**
- [excited] Now change the battleground.
- Pick Frostfall, and it snows in your room.
- [hushed] Pick the siege at dusk, and the lights go down.
- The weather keeps clear of your face, and you can always see the room.

**On-screen caption:** Six battlegrounds · your room follows

## Beat 6: the headset menu, height and sound (1:12 to 1:24)

**Shot:** The menu open beside the board; a fingertip presses ▲ twice and the board rises; Music switched off, Sound
left on; then both hands pinch the board's edges and resize it.

**Narration:**
- [warm] Everything is in reach.
- Raise the board, turn the music off, or take it in both hands and make it bigger.
- Controllers work too.

**On-screen caption:** Height ▲ ▼ · Sound · Music · hands or controllers

## Beat 7: result card and share QR (1:24 to 1:38)

**Shot:** Checkmate; the result card reads VICTORY; "Share this battle" pressed; the share card shows the QR code and
siegemate.pages.dev; cut to a phone playing the replay.

**Narration:**
- [confident] Win, and share the battle.
- The code holds a link that carries the whole game.
- [warm] Anyone can watch it play back, with no account and no server.

**On-screen caption:** Share this battle · the link is the replay

## Beat 8: offline note and end card (1:38 to 1:52)

**Shot:** The 2D page with the network cut (an edit overlay reads "Network off"; the game has no offline indicator of its own), the board loading and a move answered; then the
end card: Siegemate wordmark, siegemate.pages.dev.

**Narration:**
- [warm] After your first visit, it plays the computer offline.
- No install. Just the link.
- [confident] Siegemate. Living armies, on your table.

**On-screen caption:** Plays offline after the first visit · siegemate.pages.dev

---

## Notes for the edit

- Word count: 198 spoken words (tags not counted).
- The film's game sound sits under the voice and ducks while she speaks; fights and the conquest motif get the gaps.
- Beat 8's offline shot is the 2D page in desktop Chrome, as tested by `tests/e2e/offline.mjs`; do not caption it as a
  headset.
- If the cut runs long, drop Beat 6's last line first, then Beat 5's last line.
