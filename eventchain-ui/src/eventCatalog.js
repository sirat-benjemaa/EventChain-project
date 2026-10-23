import { BrowserProvider, Contract, Interface, formatEther, isAddress } from "ethers";
import EVENT_ABI from "./abi/EventContract.json" with { type: "json" };
import { EVENT_LINKS, buildReservationUrl, normalizeEventId, resolveEventLink } from "./eventLinks.js";

export const EVENT_CHAIN_ID = BigInt(import.meta.env?.VITE_EVENT_CHAIN_ID || "11155111");
export const EVENT_CONTRACT_ADDRESS = import.meta.env?.VITE_EVENT_CONTRACT_ADDRESS?.trim() || "";
export const TICKET_APP_URL = import.meta.env?.VITE_TICKET_APP_URL?.trim() || "";

// Uses the supplied catalog ABI by default; also accepts compiler artifacts.
function validateCatalog(config) {
  if (!isAddress(config.contractAddress)) throw new Error("Set the deployed EventContract catalog address.");
  const abi = Array.isArray(config.abi) ? config.abi : config.abi?.abi;
  if (!Array.isArray(abi) || !abi.length) throw new Error("Supply the real EventContract ABI.");
  const iface = new Interface(abi);
  for (const signature of ["getAllEventIds()", "getEvent(uint256)", "isEventAvailable(uint256)", "getTicketsAvailable(uint256)"]) {
    if (!iface.getFunction(signature)) throw new Error(`The function ${signature} is missing from the catalog ABI.`);
  }
  return abi;
}

export async function connectCatalogWallet(chainId = EVENT_CHAIN_ID) {
  if (!window.ethereum) throw new Error("Install or enable MetaMask first.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error(`Switch MetaMask to chain ${chainId}.`);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export async function readCatalogEvent(contract, id, config) {
  const eventId = normalizeEventId(id);
  const item = await contract["getEvent(uint256)"](eventId);
  if (normalizeEventId(item.id) !== eventId) throw new Error(`Catalog returned a different event ID for #${eventId}.`);
  const [available, remaining] = await Promise.all([
    contract["isEventAvailable(uint256)"](eventId),
    contract["getTicketsAvailable(uint256)"](eventId),
  ]);
  const timestamp = Number(item.date);
  if (!Number.isFinite(new Date(timestamp * 1000).getTime())) throw new Error(`Invalid date for event #${eventId}.`);
  const selection = { eventId, chainId: config.chainId, registryAddress: config.contractAddress };
  let link;
  let mappingError = "";
  try { link = resolveEventLink(selection, config.links ?? EVENT_LINKS); }
  catch (error) { mappingError = error.message; }
  return {
    id: eventId, chainId: String(config.chainId), registryAddress: config.contractAddress,
    name: item.name, location: item.location, date: timestamp,
    price: formatEther(item.ticketPrice), priceWei: item.ticketPrice.toString(),
    capacity: item.ticketCapacity.toString(), sold: item.ticketsSold.toString(),
    remaining: remaining.toString(), organizer: item.organizer,
    cancelled: item.cancelled, available,
    ticketContractAddress: link?.ticketContractAddress ?? null,
    reservationUrl: link && config.ticketAppUrl && available && !item.cancelled
      ? buildReservationUrl(config.ticketAppUrl, selection, config.links ?? EVENT_LINKS) : null,
    mappingError,
  };
}

export async function loadEvents(provider, options = {}) {
  if (!provider) throw new Error("Connect MetaMask before loading events.");
  const config = {
    abi: EVENT_ABI,
    contractAddress: EVENT_CONTRACT_ADDRESS,
    chainId: EVENT_CHAIN_ID,
    ticketAppUrl: TICKET_APP_URL,
    ...options,
  };
  const abi = validateCatalog(config);
  if ((await provider.getNetwork()).chainId !== BigInt(config.chainId)) throw new Error(`The catalog requires chain ${config.chainId}.`);
  if (await provider.getCode(config.contractAddress) === "0x") throw new Error("No event catalog is deployed at this address on the selected network.");
  const catalog = new Contract(config.contractAddress, abi, provider);
  const ids = await catalog.getAllEventIds();
  return (await Promise.all(ids.map((id) => readCatalogEvent(catalog, id, config)))).reverse();
}
