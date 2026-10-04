function HowToPlay({ isPractice = false }) {
  return (
    <div className="how-to-play">
      <p className="rules-intro">A hidden word. A little bluffing. A convincing argument.</p>
      <p>Win chips by making the best case that your word connects to the Judge’s word. Play with 3–8 friends, together or on a voice call.</p>
      <ol className="rules-steps">
        <li><strong>Peek and bet</strong><p>Reveal your own word privately. Check, bet, or fold before the Judge’s word appears.</p></li>
        <li><strong>Make your case</strong><p>When the Judge’s word appears, explain the connection out loud. Creative arguments and bluffing are allowed. Select “Mark Argued” when you finish.</p></li>
        <li><strong>Bet, then reveal</strong><p>Bet again after the opening statements. Remaining contenders reveal their real words and make a closing argument.</p></li>
        <li><strong>Vote and win</strong><p>Vote for another player’s word, never your own. Most hands have three categories: the players’ vote, the Judge’s vote, and word similarity. Win two categories to take the hand; similarity settles a split. In the final two-player duel, similarity decides.</p></li>
      </ol>
      <h3>At the table</h3>
      <dl className="rules-glossary">
        <div><dt>Check</dt><dd>Stay in without adding chips when nothing is owed.</dd></div>
        <div><dt>Call</dt><dd>Match the current bet with the amount shown.</dd></div>
        <div><dt>Raise to</dt><dd>Your total bet for this betting round, including chips you already put in.</dd></div>
        <div><dt>Fold</dt><dd>Stop betting and give up your chance to win the hand. Chips already committed stay in the pot. You may still vote or become Judge.</dd></div>
        <div><dt>All-in</dt><dd>Commit your remaining chips.</dd></div>
      </dl>
      <p>The Judge sits out later betting and can earn a share of eligible pots by voting for the winning word. Side pots are limited to eligible players.</p>
      <p>In an all-in showdown with a neutral Judge and three or more contenders, a majority of player votes wins; otherwise similarity decides.</p>
      {isPractice && <p className="practice-note">Practice is a shared-device demo: you control every seat. Similarity scores are placeholders; play online for actual word similarity.</p>}
    </div>
  )
}

export default HowToPlay
