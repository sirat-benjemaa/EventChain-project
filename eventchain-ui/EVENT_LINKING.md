# Event catalog to ticket reservations

The catalog in the pasted code stores multiple events. The current ticket
contract stores one event and exposes `buyTickets(quantity)` (no event ID).
The reservation app must therefore choose the ticket contract before buying
or transferring a ticket.

`src/eventLinks.js` is the mapping. An event is identified by all three fields:
**chain ID + catalog contract address + event ID**. Event #1 in two different
catalogs or networks is not the same event.

The existing Ganache contract is configured under local alias `1` with no
catalog address. This is a manual local alias, not a verified catalog event ID.
Open `http://localhost:5173/?eventId=1&chainId=1337` to use it.

## Register a real catalog event

1. Deploy the ticket contract for that event on the same network as the catalog.
2. Add an entry in `EVENT_LINKS` with the real catalog event ID, catalog address,
   chain ID, network name, RPC URL, and ticket contract address. For example,
   replacing both address placeholders with real deployed addresses:

```js
{
  eventId: "2",
  label: "Your second event",
  chainId: "1337",
  networkName: "Ganache",
  rpcUrl: "http://127.0.0.1:8545",
  registryAddress: "YOUR_CATALOG_CONTRACT_ADDRESS",
  ticketContractAddress: "TICKET_CONTRACT_ADDRESS_FOR_EVENT_2",
}
```

3. Ensure every ticket deployment implements the ABI in `src/contract.js`.
4. Use the selector on the reservation page or a generated reservation link.
   Changing the selection clears the previous event, wallet session, tickets,
   and transfer fields. Reconnect to load the selected contract. Unknown IDs
   are rejected; the app never falls back to a different ticket contract.

For Sepolia, use `chainId: "11155111"`, `networkName: "Sepolia"`, its RPC URL,
and actual Sepolia deployments. A Ganache address is not a Sepolia deployment.

## Use the corrected catalog reader

`src/eventCatalog.js` replaces the pasted service, fixes its malformed template
strings, validates the actual ABI, and adds `reservationUrl` to each event.
The supplied catalog ABI is saved in `src/abi/EventContract.json`. Its deployed
address still needs to be configured. The catalog defaults to Sepolia; the
existing local ticket deployment remains on Ganache.

In the event-listing app, use these modules and the same `EVENT_LINKS` mapping:

```js
import EVENT_ABI from "./abi/EventContract.json";
import { connectCatalogWallet, loadEvents } from "./eventCatalog";

const { provider } = await connectCatalogWallet(1337);
const events = await loadEvents(provider, {
  abi: EVENT_ABI,
  contractAddress: import.meta.env.VITE_EVENT_CONTRACT_ADDRESS,
  chainId: 1337,
  ticketAppUrl: import.meta.env.VITE_TICKET_APP_URL,
});
```

```env
VITE_EVENT_CONTRACT_ADDRESS=YOUR_REAL_CATALOG_ADDRESS
VITE_EVENT_CHAIN_ID=1337
VITE_TICKET_APP_URL=http://localhost:5173/
```

Render a reservation button for linked, available events:

```jsx
{events.map((event) => (
  <article key={event.id}>
    <h2>{event.name}</h2>
    {event.reservationUrl ? (
      <a href={event.reservationUrl}>Reserve tickets</a>
    ) : (
      <p>{event.mappingError || "Reservations unavailable"}</p>
    )}
  </article>
))}
```

This is an explicit frontend mapping, not an on-chain registry or factory.
Purchases and transfers go to the selected ticket contract. They do not update
the separate catalog's `ticketsSold` or cancellation flags.

The catalog ABI exposes one authorized `ticketContract()` address and
`recordTicketSale(eventId, quantity)` / `recordTicketRefund(eventId, quantity)`.
Its `setTicketContract(address)` does not map individual event IDs to separate
addresses. A shared multi-event ticket contract can call those catalog methods
with the relevant event ID. The legacy ticket contract here only accepts
`buyTickets(quantity)`, so its Solidity must be adapted/redeployed to participate
in that design. Do not record a purchase with a separate frontend transaction:
it could fail independently and leave the two contracts inconsistent.
Synchronizing those contracts requires their Solidity sources.
Ticket price and availability on the reservation page are read directly from
the ticket contract, which enforces its own purchase rules.

Run `npm test`, `npm run build`, and `npm run lint` in `eventchain-ui`.
