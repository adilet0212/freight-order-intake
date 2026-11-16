// Prints the parts of an API answer that matter in the demo. Reads JSON from stdin,
// optionally followed by a last line "HTTP <code>" from curl's -w option:
//   curl -s -w '\nHTTP %{http_code}' ... | node demo/show.mjs
// Plain Node, no dependencies, so it runs without jq.
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const match = input.match(/\nHTTP (\d{3})\s*$/);
  if (match) {
    console.log(`HTTP ${match[1]}`);
    input = input.slice(0, match.index);
  }
  const answer = JSON.parse(input);
  if (Array.isArray(answer)) {
    console.log(`${answer.length} order(s)`);
    for (const order of answer)
      console.log(`  ${order.status.padEnd(17)} ${order.id}  ${order.emailSubject}`);
    return;
  }
  if (!answer.status) {
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  console.log(`status:   ${answer.status}`);
  console.log(`id:       ${answer.id}`);
  for (const reason of answer.reviewReasons ?? [])
    console.log(`reason:   ${reason}`);
  for (const stop of answer.stops ?? [])
    console.log(
      `stop:     ${stop.type.padEnd(8)} ${stop.city}, ${stop.region}  ${stop.windowStart ?? '(no date)'}`,
    );
  for (const item of answer.commodities ?? [])
    console.log(
      `freight:  ${item.quantity ?? '?'} ${item.commodityType ?? ''} ${item.weightLbs ?? '?'} lbs`,
    );
});
