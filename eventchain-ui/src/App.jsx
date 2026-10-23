import { useState } from "react";
import { BrowserProvider, Contract, formatEther, isAddress } from "ethers";
import { CONTRACT_ABI } from "./contract";
import { EVENT_LINKS, buildReservationUrl, readEventSelection, resolveEventLink } from "./eventLinks";
import "./App.css";

function App() {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  const [event, setEvent] = useState(null);
  const [contract, setContract] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState("");
  const [isBuying, setIsBuying] = useState(false);
  const [myTickets, setMyTickets] = useState([]);
  const [transferId, setTransferId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [selection, setSelection] = useState(() => readEventSelection(typeof window === "undefined" ? "" : window.location.search));
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  let deployment;
  let selectionError = "";
  try { deployment = resolveEventLink(selection); }
  catch (e) { selectionError = e.message; }
  const networkName = deployment?.networkName || "Unconfigured network";
  const isBusy = isConnecting || isBuying || isTransferring;

  function selectEvent(index) {
    if (isBusy) return;
    const link = EVENT_LINKS[Number(index)];
    window.history.replaceState(null, "", buildReservationUrl(window.location.href, link));
    setSelection({ eventId: link.eventId, chainId: link.chainId, registryAddress: link.registryAddress });
    setAccount(null);
    setContract(null);
    setEvent(null);
    setMyTickets([]);
    setQuantity(1);
    setTransferId("");
    setTransferTo("");
    setStatus("");
    setError("");
  }

  async function checkActiveWallet() {
    if (!contract || !account || !deployment) throw new Error("Connect the wallet for this event first.");
    const chainId = await contract.runner.provider.send("eth_chainId", []);
    const accounts = await contract.runner.provider.send("eth_accounts", []);
    if (BigInt(chainId) !== BigInt(deployment.chainId) || accounts[0]?.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Your wallet account or network changed. Reload the page and reconnect before continuing.");
    }
  }

  async function loadEvent(contract) {
    const name = await contract.eventName();
    const price = await contract.ticketPrice();
    const date = await contract.eventDate();
    const left = await contract.ticketsLeft();
    setEvent({
      name,
      priceWei: price,
      price: formatEther(price),
      date: new Date(Number(date) * 1000).toLocaleString(),
      left: left.toString(),
    });
  }

  async function connectWallet() {
    if (isBusy) return;
    setIsConnecting(true);
    setError("");
    try {
      if (!deployment) throw new Error(selectionError);
      const { ticketContractAddress, chainId, rpcUrl } = deployment;
      if (!window.ethereum) {
        setError("MetaMask is not installed");
        return;
      }
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(chainId)) {
        setError(`Please switch MetaMask to ${networkName} (RPC: ${rpcUrl}, chain ID: ${chainId}).`);
        return;
      }
      const code = await provider.getCode(ticketContractAddress);
      if (code === "0x") {
        setError(`No ticket contract is deployed at ${ticketContractAddress} on ${networkName}. Update this event's deployment in src/eventLinks.js.`);
        return;
      }
      const signer = await provider.getSigner();
      const contract = new Contract(ticketContractAddress, CONTRACT_ABI, signer);
      await loadEvent(contract);
      const address = await signer.getAddress();
      await loadMyTickets(contract, address);
      setContract(contract);
      setAccount(address);
      setError("");
    } catch (e) {
      if (e.code === "BAD_DATA" && e.value === "0x") {
        setError(`The ticket contract for event #${selection.eventId} returned no event data. Check its address in src/eventLinks.js and its ABI in src/contract.js.`);
      } else {
        setError(e.shortMessage || e.message);
      }
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleBuy() {
    if (isBusy || !contract || !event || !account) return;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) {
      setStatus("Choose between 1 and 4 tickets.");
      return;
    }
    if (BigInt(quantity) > BigInt(event.left)) {
      setStatus("The quantity exceeds the number of tickets left.");
      return;
    }
    setIsBuying(true);
    try {
      await checkActiveWallet();
      setStatus("Waiting for MetaMask confirmation...");
      const total = event.priceWei * BigInt(quantity);
      const tx = await contract.buyTickets(quantity, { value: total });
      setStatus("Transaction sent, waiting for confirmation...");
      await tx.wait();
      setStatus("Purchase confirmed! Transaction: " + tx.hash);
      try {
        await loadEvent(contract);
        await loadMyTickets(contract, account);
      } catch {
        setStatus("Purchase confirmed! Transaction: " + tx.hash + ". Could not refresh event details; reconnect to refresh.");
      }
    } catch (e) {
      setStatus("Error: " + (e.reason || e.shortMessage || e.message));
    } finally {
      setIsBuying(false);
    }
  }
  async function loadMyTickets(c, addr) {
    const total = Number(await c.totalSold());
    const list = [];
    for (let id = 1; id <= total; id++) {
      const t = await c.getTicket(id);
      if (t.owner.toLowerCase() === addr.toLowerCase()) {
        list.push({ id, used: t.used });
      }
    }
    setMyTickets(list);
  }

  async function handleTransfer() {
    if (isBusy) return;
    setIsTransferring(true);
    try {
      await checkActiveWallet();
      if (!/^\d+$/.test(transferId) || !isAddress(transferTo)) throw new Error("Enter a valid ticket ID and recipient address.");
      setStatus("Waiting for MetaMask confirmation...");
      const tx = await contract.transferTicket(transferId, transferTo);
      await tx.wait();
      setStatus("Ticket transferred!");
      try { await loadMyTickets(contract, account); }
      catch { setStatus("Ticket transferred! Could not refresh the ticket list; reload and reconnect."); }
    } catch (e) {
      setStatus("Error: " + (e.reason || e.message));
    } finally {
      setIsTransferring(false);
    }
  }

  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 4;
  const total = event && validQuantity ? formatEther(event.priceWei * BigInt(quantity)) : "--";
  const soldOut = event?.left === "0";

  return (
    <div className="reservation-app">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#" aria-label="EventChain home"><span className="brand-symbol" aria-hidden="true"><i /><i /></span>Event<span>Chain</span></a>
          <nav aria-label="Main navigation"><a className="nav-active" href="#event">Event details</a><a href="#my-tickets">My tickets</a></nav>
          <div className="header-wallet">
            <span className="network"><i />{networkName}</span>
            {account ? <span className="wallet-address" title={account}>{account.slice(0, 6)}...{account.slice(-4)}</span> : <button className="button header-connect" onClick={connectWallet} disabled={isBusy || !deployment}>Connect wallet <span aria-hidden="true">&#8599;</span></button>}
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="page-heading"><div><p className="eyebrow">EVENT RESERVATIONS</p><h1>Your next experience starts here.</h1></div><span className="page-index">EVENTCHAIN</span></div>
        <div className="event-selector">
          <label htmlFor="selected-event">Choose your event</label>
          <select id="selected-event" value={deployment ? EVENT_LINKS.indexOf(deployment) : ""} onChange={(e) => selectEvent(e.target.value)} disabled={isBusy}>
            {!deployment && <option value="" disabled>Unlinked event #{selection.eventId}</option>}
            {EVENT_LINKS.map((link, index) => <option key={`${link.chainId}:${link.registryAddress}:${link.eventId}`} value={index}>{link.label} - #{link.eventId} ({link.networkName})</option>)}
          </select>
          {deployment && <span>Event #{deployment.eventId} / {networkName}</span>}
        </div>
        {selectionError && <p className="notice notice-error" role="alert">{selectionError}</p>}
        <div className="reservation-layout" id="event">
          <div className="event-column">
            <section className="event-cover" aria-label="Event presentation">
              <div className="cover-art" aria-hidden="true"><div className="light-beam beam-one" /><div className="light-beam beam-two" /><div className="light-beam beam-three" /><div className="stage-ring ring-one" /><div className="stage-ring ring-two" /><div className="stage-ring ring-three" /><span className="stage-floor" /></div>
              <div className="cover-top"><span>EVENTCHAIN PRESENTS</span><span className="cover-tag">THE LIVE EXPERIENCE</span></div>
              <div className="cover-bottom"><p>MAKE ROOM FOR THE MOMENT.</p><h2>{event ? event.name : "Be part of it."}</h2><div className="cover-bottom-line"><span>YOUR ACCESS TO WHAT'S NEXT</span><span aria-hidden="true">&#8599;</span></div></div>
            </section>

            <section className="event-overview" aria-labelledby="overview-title">
              <div className="section-heading"><h2 id="overview-title">Event details</h2><span className={`availability ${soldOut ? "unavailable" : ""}`}><i />{event ? soldOut ? "Sold out" : "Tickets available" : "Connect to view"}</span></div>
              <p className="section-description">{event ? "Choose your tickets and confirm your reservation with your wallet. Your tickets will appear in your collection once the transaction is confirmed." : "Connect your wallet to view this event's date, ticket price, and availability. Then choose your tickets and confirm your reservation."}</p>
              <dl className="event-facts"><div><dt><span className="detail-icon" aria-hidden="true">&#9638;</span>Date &amp; time</dt><dd>{event ? event.date : "Connect to view event date"}</dd></div><div><dt><span className="detail-icon" aria-hidden="true">&#9678;</span>Availability</dt><dd>{event ? `${event.left} tickets remaining` : "Connect to check availability"}</dd></div></dl>
              <div className="reservation-steps"><div><span>01</span><p>Connect your wallet</p></div><div><span>02</span><p>Select your tickets</p></div><div><span>03</span><p>Confirm your reservation</p></div></div>
            </section>
          </div>

          <aside className="booking-card" aria-labelledby="booking-title">
            <div className="booking-topline"><span>YOUR RESERVATION</span><span aria-hidden="true">&#8599;</span></div>
            <h2 id="booking-title">Reserve your spot</h2><p className="booking-description">Select your tickets. Be there for the experience.</p>
            <div className="ticket-option"><div><span className="ticket-option-label">Event ticket</span><span className="ticket-option-note">{event ? event.name : "EventChain reservation"}</span></div><span className="option-radio" aria-hidden="true" /></div>
            <div className="ticket-price"><strong>{event ? event.price : "--"}</strong><span>ETH <small>per ticket</small></span></div>
            {event && account ? <>
              <div className="quantity-row"><label htmlFor="quantity">Number of tickets<small>Maximum 4 per purchase</small></label><input id="quantity" type="number" min="1" max="4" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} disabled={isBusy} /></div>
              <div className="order-row"><span>Tickets {validQuantity ? `(${quantity})` : ""}</span><span>{total} ETH</span></div><div className="order-row network-fee"><span>Network fee</span><span>Calculated by wallet</span></div><div className="order-total"><span>Total</span><strong>{total} <small>ETH</small></strong></div>
              <button className="button button-primary" onClick={handleBuy} disabled={isBusy || soldOut || !validQuantity}>{isBuying ? "Confirming reservation..." : soldOut ? "Sold out" : "Reserve tickets"}<span aria-hidden="true">&#8594;</span></button>
              <p className="booking-help">Confirm the transaction in MetaMask to complete your reservation.</p>
            </> : <>
              <div className="connection-prompt"><span className="step-circle">1</span><p>Connect your wallet<small>View availability and start your reservation.</small></p></div>
              <button className="button button-primary" onClick={connectWallet} disabled={isBusy || !deployment}>Connect wallet to reserve <span aria-hidden="true">&#8594;</span></button>
              <p className="booking-help">Use MetaMask with the {networkName} network.</p>
            </>}
            <div className="booking-network"><span className="network"><i />{networkName}</span><span>Test ETH only</span></div>
          </aside>
        </div>

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {status && <p className="notice" role="status">{status}</p>}

        <section className="tickets-section" id="my-tickets" aria-labelledby="tickets-title">
          <div className="section-heading collection-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h2 id="tickets-title">My tickets <span className="ticket-count">{account ? myTickets.length : "--"}</span></h2></div><p>Tickets for the selected event.</p></div>
          {account ? <div className="collection-layout">
            <div className="ticket-collection">{myTickets.length === 0 ? <div className="empty-state"><span className="empty-ticket" aria-hidden="true">&#9638;</span><h3>No tickets yet</h3><p>Your confirmed tickets will appear here.<br />Reserve your spot to get started.</p><a href="#event">View event <span aria-hidden="true">&#8599;</span></a></div> : <div className="ticket-list">{myTickets.map((t) => <article className={`owned-ticket ${t.used ? "ticket-used" : ""}`} key={t.id}><div className="ticket-serial"><span>TICKET</span><strong>#{t.id}</strong></div><div className="owned-ticket-info"><h3>{event?.name || "Event ticket"}</h3><p>{event?.date || "EventChain reservation"}</p><span className={`ticket-status ${t.used ? "status-used" : ""}`}><i />{t.used ? "Used" : "Valid ticket"}</span></div><div className="ticket-barcode" aria-hidden="true" /></article>)}</div>}</div>
            <article className="transfer-card"><div className="transfer-heading"><h3>Transfer a ticket</h3><span aria-hidden="true">&#8599;</span></div><p>Send a ticket to another wallet. Check the recipient address before confirming.</p><label htmlFor="transfer-id">Ticket ID</label><input id="transfer-id" placeholder="Enter ticket ID" disabled={isBusy} value={transferId} onChange={(e) => setTransferId(e.target.value)} /><label htmlFor="transfer-to">Recipient address</label><input id="transfer-to" placeholder="0x..." disabled={isBusy} value={transferTo} onChange={(e) => setTransferTo(e.target.value)} /><button className="button button-secondary" onClick={handleTransfer} disabled={isBusy}>{isTransferring ? "Transferring..." : "Transfer ticket"} <span aria-hidden="true">&#8594;</span></button></article>
          </div> : <div className="collection-disconnected"><span className="collection-icon" aria-hidden="true">&#9638;</span><div><h3>Your tickets, ready when you are.</h3><p>Connect your wallet to view and manage your reservations.</p></div><button className="button button-secondary" onClick={connectWallet} disabled={isBusy || !deployment}>Connect wallet <span aria-hidden="true">&#8599;</span></button></div>}
        </section>
      </main>
      <footer className="site-footer"><div className="footer-inner"><span className="footer-brand">EventChain</span><p>Experiences worth showing up for.</p><span>Ethereum / {networkName}</span></div></footer>
    </div>
  );
}

export default App;

