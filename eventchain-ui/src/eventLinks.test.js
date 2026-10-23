import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import EVENT_ABI from "./abi/EventContract.json" with { type: "json" };
import { buildReservationUrl, readEventSelection, resolveEventLink } from "./eventLinks.js";
import { loadEvents, readCatalogEvent } from "./eventCatalog.js";

const registry = "0x1111111111111111111111111111111111111111";
const otherRegistry = "0x2222222222222222222222222222222222222222";
const firstAddress = "0x3333333333333333333333333333333333333333";
const secondAddress = "0x4444444444444444444444444444444444444444";
const links = [
  { eventId: "1", chainId: "1337", registryAddress: registry, ticketContractAddress: firstAddress },
  { eventId: "2", chainId: "1337", registryAddress: registry, ticketContractAddress: secondAddress },
  { eventId: "1", chainId: "11155111", registryAddress: registry, ticketContractAddress: secondAddress },
  { eventId: "1", chainId: "1337", registryAddress: otherRegistry, ticketContractAddress: secondAddress },
];
const selection = { eventId: "1", chainId: "1337", registryAddress: registry };

test("each event resolves to its own ticket contract", () => {
  assert.equal(resolveEventLink(selection, links).ticketContractAddress, firstAddress);
  assert.equal(resolveEventLink({ ...selection, eventId: "2" }, links).ticketContractAddress, secondAddress);
});

test("the same event ID on another chain or catalog stays isolated", () => {
  assert.equal(resolveEventLink({ ...selection, chainId: "11155111" }, links).ticketContractAddress, secondAddress);
  assert.equal(resolveEventLink({ ...selection, registryAddress: otherRegistry }, links).ticketContractAddress, secondAddress);
  assert.throws(() => resolveEventLink({ ...selection, registryAddress: "" }, links), /No ticket contract/);
});

test("unknown, invalid and duplicate mappings cannot silently select a contract", () => {
  assert.throws(() => resolveEventLink({ ...selection, eventId: "99" }, links), /No ticket contract/);
  assert.throws(() => resolveEventLink({ ...selection, eventId: "abc" }, links), /integer/);
  assert.throws(() => resolveEventLink(selection, [...links, links[0]]), /Duplicate/);
  assert.throws(() => resolveEventLink(selection, [{ ...links[0], ticketContractAddress: "invalid" }]), /Invalid ticket/);
});

test("reservation links preserve event identity across the two apps", () => {
  const url = buildReservationUrl("http://localhost:5173/?source=catalog", { ...selection, eventId: "02" }, links);
  assert.deepEqual(readEventSelection(new URL(url).search), { ...selection, eventId: "2" });
  assert.equal(new URL(url).searchParams.get("source"), "catalog");
  assert.throws(() => buildReservationUrl("javascript:alert(1)", selection, links), /HTTP/);
});

test("URL contract addresses do not override the configured mapping", () => {
  const parsed = readEventSelection(`?eventId=1&chainId=1337&registryAddress=${registry}&contractAddress=${secondAddress}`);
  assert.equal(resolveEventLink(parsed, links).ticketContractAddress, firstAddress);
});

const options = { contractAddress: registry, chainId: "1337", links, ticketAppUrl: "http://localhost:5173/" };
function catalogFixture({ id = 2n, available = true, cancelled = false } = {}) {
  return {
    "getEvent(uint256)": async () => ({ id, name: "Second event", location: "Tunis", date: 1800000000n, ticketPrice: 100000000000000000n, ticketCapacity: 100n, ticketsSold: 1n, organizer: registry, cancelled }),
    "isEventAvailable(uint256)": async () => available,
    "getTicketsAvailable(uint256)": async () => 99n,
  };
}

test("catalog data includes a reservation URL for the matching event contract", async () => {
  const event = await readCatalogEvent(catalogFixture(), 2n, options);
  assert.equal(event.id, "2");
  assert.equal(event.price, "0.1");
  assert.equal(event.priceWei, "100000000000000000");
  assert.equal(event.ticketContractAddress, secondAddress);
  assert.equal(new URL(event.reservationUrl).searchParams.get("eventId"), "2");
});

test("unmapped, cancelled and unavailable events have no reservation link", async () => {
  const unmapped = await readCatalogEvent(catalogFixture(), 2n, { ...options, links: [] });
  assert.equal(unmapped.reservationUrl, null);
  assert.equal(unmapped.ticketContractAddress, null);
  assert.match(unmapped.mappingError, /No ticket contract/);
  for (const change of [{ available: false }, { cancelled: true }]) {
    assert.equal((await readCatalogEvent(catalogFixture(change), 2n, options)).reservationUrl, null);
  }
});

test("catalog event IDs and the real ABI must be validated", async () => {
  await assert.rejects(() => readCatalogEvent(catalogFixture(), 1n, options), /different event ID/);
  await assert.rejects(() => loadEvents({}, { ...options, abi: [] }), /real EventContract ABI/);
});

test("the supplied real ABI decodes catalog events and links each ID separately", async () => {
  const iface = new Interface(EVENT_ABI);
  const provider = {
    getNetwork: async () => ({ chainId: 1337n }),
    getCode: async () => "0x6000",
    call: async ({ data }) => {
      const tx = iface.parseTransaction({ data });
      let output;
      if (tx.name === "getAllEventIds") output = [[1n, 2n]];
      else if (tx.name === "getEvent") output = [[tx.args[0], `Event ${tx.args[0]}`, "Tunis", 1800000000n, 100000000000000000n, 100n, 1n, registry, false]];
      else if (tx.name === "isEventAvailable") output = [true];
      else if (tx.name === "getTicketsAvailable") output = [99n];
      else throw new Error("Unexpected contract call");
      return iface.encodeFunctionResult(tx.fragment, output);
    },
  };
  const events = await loadEvents(provider, options);
  assert.deepEqual(events.map((event) => event.id), ["2", "1"]);
  assert.equal(events[0].ticketContractAddress, secondAddress);
  assert.equal(events[1].ticketContractAddress, firstAddress);
  assert.equal(events[0].location, "Tunis");
  await assert.rejects(() => loadEvents({ ...provider, getNetwork: async () => ({ chainId: 11155111n }) }, options), /requires chain/);
  await assert.rejects(() => loadEvents({ ...provider, getCode: async () => "0x" }, options), /No event catalog/);
});
