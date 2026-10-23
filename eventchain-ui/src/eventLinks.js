import { getAddress, isAddress } from "ethers";
import { CONTRACT_ADDRESS } from "./contract.js";
import { CHAIN_ID, NETWORK_NAME, RPC_URL } from "./network.js";

// Each catalog event needs its own explicit ticket-contract deployment.
// ID 1 below is a LOCAL alias for the existing Ganache concert, not an ID
// verified against the external EventContract catalog.
export const EVENT_LINKS = [
  {
    eventId: "1",
    label: "EventChain Concert",
    chainId: CHAIN_ID.toString(),
    networkName: NETWORK_NAME,
    rpcUrl: RPC_URL,
    registryAddress: "",
    ticketContractAddress: CONTRACT_ADDRESS,
  },
];

export function normalizeEventId(value) {
  const id = String(value);
  if (!/^\d+$/.test(id)) throw new Error("Event ID must be a non-negative integer.");
  return BigInt(id).toString();
}

function normalizeRegistry(address = "") {
  if (!address) return "";
  if (!isAddress(address)) throw new Error("Invalid event catalog contract address.");
  return getAddress(address).toLowerCase();
}

export function resolveEventLink(selection, links = EVENT_LINKS) {
  const eventId = normalizeEventId(selection.eventId);
  const chainId = normalizeEventId(selection.chainId);
  const registry = normalizeRegistry(selection.registryAddress);
  const matches = links.filter((link) =>
    normalizeEventId(link.eventId) === eventId &&
    normalizeEventId(link.chainId) === chainId &&
    normalizeRegistry(link.registryAddress) === registry,
  );
  if (matches.length !== 1) {
    throw new Error(matches.length ? "Duplicate event-to-contract mapping." : `No ticket contract is linked to event #${eventId} on chain ${chainId}. Add its deployment to src/eventLinks.js.`);
  }
  const link = matches[0];
  if (!isAddress(link.ticketContractAddress)) throw new Error(`Invalid ticket contract address for event #${eventId}.`);
  return link;
}

export function readEventSelection(search = "") {
  const params = new URLSearchParams(search);
  return {
    eventId: params.get("eventId") ?? EVENT_LINKS[0].eventId,
    chainId: params.get("chainId") ?? EVENT_LINKS[0].chainId,
    registryAddress: params.get("registryAddress") ?? "",
  };
}

export function buildReservationUrl(baseUrl, selection, links = EVENT_LINKS) {
  const link = resolveEventLink(selection, links);
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Ticket app URL must use HTTP or HTTPS.");
  url.searchParams.set("eventId", normalizeEventId(link.eventId));
  url.searchParams.set("chainId", normalizeEventId(link.chainId));
  if (link.registryAddress) url.searchParams.set("registryAddress", getAddress(link.registryAddress));
  else url.searchParams.delete("registryAddress");
  return url.toString();
}
