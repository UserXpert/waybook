# Appointment, waitlist, and checkout workflow

This specification defines the front-desk workflow for Waybook. It uses the Mangomint playground session observed on 26 November 2026 as the functional benchmark. Waybook uses its own components, typography, spacing, and theme. Staff should be able to complete the same sequence with the same information carried forward and a clear next action in each state.

## Book from the calendar

1. Select an open slot. Open the booking drawer alongside the calendar and carry in the date, start time, location, and staff member. For the general New appointment action, provide an editable starting date and location.
2. Focus client search. Search by name, email, or phone according to the operator’s directory permissions. Show identifying contact details per result so staff can distinguish similar names. Selecting a result displays a compact client summary with a Change action.
3. Offer **Add client** from the search, including when there are no matches. Seed the name from the search and collect the contact fields inline. Return the newly created client to the same draft. Cancelling inline creation restores search and preserves the appointment choices.
4. Open a searchable service catalogue. Group services under their existing categories where available. Show name, price, and duration on each result. Keep the selection surface usable with keyboard, pointer, and touch. Restrict choices to the selected location and make any staff eligibility conflict clear before confirmation.
5. Show each selected service as an editable row with its staff member, start time, duration, and price. **Add service** appends another row after the preceding service by default. Staff can change the assigned provider or timing where eligible. Show all segments on the calendar as one linked appointment and update the combined duration and price as the draft changes.
6. Keep the send-confirmation choice where supported by tenant settings. Preserve the workspace’s operations-only boundary for notes. Provide one primary **Book appointment** action. The server must recheck all segments and create the appointment atomically. If a slot changes, preserve the draft and identify the affected segment so staff can select another time.
7. After saving, open the confirmed appointment in the same calendar context. Display the client, booking time, all service rows, and the next action. Apply the same review and atomic save rules when adding or changing services on an existing appointment.

In the playground, a 2:00 PM Signature Facial with Harriet saved as Confirmed. Editing it and adding an Express Facial created consecutive linked blocks from 2:00–3:30 PM and 3:30–4:15 PM. The rows retained their individual prices of $100 and $80. The notification option was off for the edit.

## Book a waitlist opening

1. Open Waitlist from the calendar. Show the date-specific entry count and let staff filter by date, location, staff, and available openings. Opening the waitlist keeps the calendar context visible.
2. Create an entry using the same client and service selectors as a new booking. Collect the preferred staff member or any eligible staff, an optional time window, and alternative dates or an earliest acceptable opening. Show the saved request even before an opening matches.
3. Match against real availability, including staff and resource requirements, location hours, competing bookings, and the requested window. Present a matching opening in the entry with **Book** and **Dismiss**. Dismissing an opening keeps the request active.
4. **Book** opens the standard appointment drawer with the matched date, time, client, and service rows filled in. The operator reviews and confirms using the normal booking action. If booking fails, the waitlist entry stays actionable.
5. On a successful conversion, mark that Waybook entry Booked as part of the appointment save and retain its history. Leave other entries for the client available for individual review. The confirmed appointment proceeds through regular check-in and checkout.

In the playground, the past-date entry showed preferences without a booking action. A future request for Express Facial with Harriet showed **Book**, which opened a prefilled 11:00 AM draft and saved an 11:00–11:45 AM appointment. Mangomint then offered to keep or remove the waitlist entry. Waybook’s Booked state preserves the converted entry in its history. [Mangomint’s guide to booking from the waitlist](https://www.mangomint.com/learn/book-from-the-waitlist/)

## Check in, start service, and handle no-shows

| Appointment state | Primary action | Result |
| --- | --- | --- |
| Confirmed | Check in | Choose Waiting room or In service. |
| Waiting room | Start service | Move the appointment to In service. Make any staff notification an explicit action governed by workspace settings. |
| In service | Checkout | Open the checkout for the existing appointment and carry forward the client and services. |
| Checking out | Continue checkout | Resume the same sale with its items, discounts, and any posted transactions. |
| Completed | View sale or Rebook | Open the historical sale or start a new draft with the relevant client and services. |

Treat those front-desk actions as explicit transitions, gated by the operator’s permissions. Preserve the separate **Save changes** behaviour for edits within the appointment drawer. For a No show, show payment method and amount directly in that drawer, including when the current service balance is zero. The operator can select Completed and submit once. If required payment details are missing, show a compact inline message and keep the draft. Commit the no-show payment and completion atomically.

In Chrome, **Check-in** offered **Waiting Room** or **In Service**. Waiting Room showed **Notify** and **In Service**. Moving the demo appointment into service revealed **Checkout**. The future appointment showed a confirmation before checkout. The playground card test used a separate appointment with checkout already in progress.

## Review checkout

1. Open checkout for the existing appointment with the client and editable sale lines in view. Show each booked service with its provider, quantity where relevant, and booked price. Display added products separately. Group secondary options such as adjustments and eligible redemptions under an accessible secondary action.
2. Keep a running subtotal and a clear **Go to payments** action. Changes to line items must update the amount due. Show whether any item is still pending checkout before describing its amount as payable.
3. Open Payments in the same context. Show subtotal, optional tip when supported, total, previous payments, and outstanding amount. Prefill the payment amount from the outstanding balance. Returning to review keeps the sale and its edits.

## Take or record payment

1. Present available tenders directly. Distinguish a processor-enabled **Charge card** from **Record payment** for money already received. Show each method only when the tenant supports it and the operator has the relevant permission.
2. Cash and other externally collected tender show the amount and a clear record action. Gift card and account balance flows validate eligibility and available balance before applying tender. Card processing displays the exact amount and selected card before requiring explicit charge confirmation. Hosted card entry must use the payment provider’s secure controls.
3. Keep the pending state visible during submission. Prevent duplicate submissions across retries and tabs. If the amount is invalid or payment fails, retain the draft and give the operator an actionable correction. If a response is interrupted, resolve the prior attempt before allowing another charge.
4. After settlement, show a closed sale with services, totals, and transaction history. Expose the transaction method and amount, receipt actions where configured, and Rebook appointment. Waybook’s existing one-payment rule applies to manual receipts. Once a manual receipt exists, show the recorded payment with Edit and Delete where permitted. Enable recording a replacement after deletion. Preserve corrections and refunds in the ledger.
5. Honour explicit refund and adjustment permissions. Reconcile package and gift card activity with the sale record. Keep payment restrictions consistent between the appointment drawer and Sales.

**Verified in the playground.** Checkout showed a $100 service subtotal with Add service, Add product, and More. Go to payments displayed optional tip, a $100 total, and an editable $100 charge amount. Available choices were Front Desk, Self Checkout, Credit Card, Cash, Gift Card, Account Balance, and Other. Credit Card opened a confirmation view with the amount and card selection. Mangomint supplied a test card in playground mode. Submitting it opened Sale #18 (Closed), with a $100 card transaction and Rebook appointment. The test did not move real funds.

### Additional tender paths documented by Mangomint

| Path | Front-desk behaviour |
| --- | --- |
| Cash, Check, custom method, Other | Cash posts to the cash drawer count when that feature is on. Check and custom tenders can be enabled in settings. Other can carry a tender note. An external tender records a payment handled outside Mangomint. [Payment types](https://www.mangomint.com/learn/payment-types/) |
| Gift card and client account balance | Gift Card shows an availability count, supports a card on file, lookup, or barcode scan, and leaves any uncovered amount available for settlement. Account Balance applies the client's available balance. [Gift card tender](https://www.mangomint.com/learn/how-to-use-redeem-a-gift-card-during-checkout/) · [Payment types](https://www.mangomint.com/learn/payment-types/) |
| Front Desk Display | The customer sees the total on the configured device, pays using its card reader or digital wallet, adds a tip, signs if required, and chooses receipt delivery. The operator's sale closes after success. [Front Desk Display](https://www.mangomint.com/learn/how-to-take-payments-with-the-front-desk-display/) |
| Client Self Checkout | The operator confirms the destination phone number and sends a payment link. The operator sees a waiting state. The customer reviews line items, tips, and pays on their phone. A receipt becomes available and the sale closes after success. [Client Self Checkout](https://www.mangomint.com/learn/client-self-check-out/) |
| Partial or split payment | Enter the amount for the first tender. The system posts that transaction, recalculates the balance, and accepts another tender for the remainder. The closed sale lists both transactions. Waybook's requested single manual receipt rule remains the current behaviour. Split manual tender would change that rule. [Split payments](https://www.mangomint.com/learn/how-to-split-payments/) |
| Receipts and refunds | The closed sale supports sending or printing a receipt. A single payment can be refunded from its own sale transaction menu. Open-sale deposits have a separate refund path. [Receipts](https://www.mangomint.com/learn/send-client-receipt/) · [Single-payment refund](https://www.mangomint.com/learn/refunding-a-single-payment/) · [Open-sale refund](https://www.mangomint.com/learn/refunding-a-deposit/) |

### Additional playground evidence

- **Cart.** Checkout carried the two services into one cart with separate $100 and $80 lines and a $180 subtotal. Expanding a service showed its editable price and provider. Add Product opened a searchable, grouped catalogue. Adding a $20 product associated it with the provider and raised the subtotal to $200. More offered Gift Card, Package, Offer, and Account Balance.
- **Payment choice.** Gift Card opened a search field and Cancel. Account Balance displayed the current balance and amount, warned explicitly when applying the amount would create an IOU, and required Confirm. Other showed the amount and an optional reference. Self Checkout displayed a phone confirmation and Send. The test stopped before sending a text.
- **Split settlement.** Changing the amount to $20 and choosing Cash posted the entry in the playground and prefilled the $180 remainder. Front Desk offered a simulation with **Complete test payment**. Completing it closed Sale #19 with $20 Cash and $180 Other, identified as Front Desk Demo. The $200 cart and its three lines remained visible. Both calendar segments were completed and the appointment exposed View Sale.
- **Sale and transaction menus.** The closed sale exposed Change Date, Add Notes, Reopen, Refund, Print Receipt, and Send Receipt. Send Receipt opened an email confirmation. The test cancelled that dialog. Transaction View Details showed the amount, timestamp, method, and staff payment channel. The cash line offered a transaction-level Refund action in this sale.
- **Refund preview.** The cash refund offered specific line items or just refunding the payment. The latter would reopen an amount due. Selecting the product opened quantity and restock choices, then Full refund, Partial refund, or No refund. The $20 summary identified one restocked item. The final step allowed a refund to an original method, gift card, or account balance, with a note. Leaving the draft kept the closed sale accessible and exposed Refund (Continue). The refund was left in progress in the playground, with no transaction posted.

### Benchmark verification still open

The complete linked appointment, product checkout, split cash and simulated Front Desk settlement, and card settlement were exercised in Chrome. Additional live verification remains for gift card redemption, account balance and IOU completion, Other submission, actual front-desk hardware, the customer's text-link experience, receipt delivery, and refund settlement. The documentation above distinguishes those steps from observed screens and transactions.

## Waybook acceptance checks

| Scenario | Expected result |
| --- | --- |
| Calendar slot, existing client | Slot context carries over. Search selects the tenant’s client by ID. The booking uses that ID and preserves the client record. |
| Calendar slot, new client | The client can be added inside the booking flow. Switching to or from inline creation preserves all other draft fields. |
| Two services | The calendar shows both linked segments. Moving or editing the appointment preserves eligibility and all-or-nothing writes. Checkout sees the same service rows and their combined subtotal. |
| Waitlist opening | The confirmed slot and the Booked waitlist state commit together. Stale openings and repeated conversion attempts leave no orphan booking or duplicate sale. |
| Check in through checkout | Verify both check-in choices, the transition into service, and reopening an in-progress checkout without duplicating the sale. |
| Unpaid No show | Save changes identifies missing payment details inline. Valid payment details and Completed persist together on one save. |
| Payment review and settlement | Total matches the lines and tender. Invalid amounts, failed payments, interrupted responses, and concurrent attempts produce reliable ledger state. A successful payment shows the closed sale. |
| Existing receipt | The checkout presents its permitted correction actions. Deletion restores the ability to record a replacement. The audit trail remains available. |
| Access and responsive layout | Verify each permitted staff role, tenant isolation, keyboard operation, and the complete flow on desktop and mobile. |

The first Waybook changes cover booking client lookup and pricing, waitlist conversion, a calendar handoff to checkout, and separate review and manual payment stages. Track implementation and verification of linked services, the Waiting room and In service states, and processor-supported tender through the appointment workflow goal. The spec describes the intended end state.

## Release milestones

Release major workflows to Vercel as they become ready, then continue with the next milestone. The initial candidate covers single-service staff booking, waitlist conversion, checkout review, manual payment recording, and no-show completion. Verify the candidate on desktop and mobile, review the hosted preview, and follow the [local-to-production workflow](11_local_release_workflow.md) for the pull request and database checks. Use the same release process for linked services and their shared checkout, check-in through service, and processor-backed payments as each becomes usable end to end.

## Waybook implementation notes

- The calendar entry point must open a usable draft even when the initial staff member has no assigned service. Keep Location, Staff, and Service available and require a valid selection before offering times.
- **Check openings** shows up to three bookable times for the selected waitlist request. It searches the preferred date or the next seven calendar days, respects the requested staff member and time window, and uses the existing calendar rules for staff availability and location hours. Resources remain assigned after booking under the current calendar capacity model.
- **Book** opens the appointment drawer on the proposed time and staff member, with the request's client, location, and service. If the time was taken, the drawer asks staff to choose another time explicitly. Confirmation uses the request's client ID and commits the booking and Booked status together. Manual calendar search remains available. Proactive opening alerts and dismissing an individual suggestion remain open.
- The appointment checkout total includes products at their recorded prices, the booked service balance after package coverage, and any no-show fee. Use the same total in Sales, Bookings, and the appointment payment drawer. Migration 0063 enforces the payment limit and prevents product edits once the appointment has payment history. Checkout rejects a payment from a stale tab if the balance changed.
- Linked services share one booking number, client, attendance state, and sale. Migration 0064 keeps the first service on the existing booking and gives each added service a separate reservation. The ledger includes the added service prices. Existing package coverage still applies to the primary service only. The booking editor must save every reservation in one transaction, and the calendar must display each one in the assigned provider’s lane. Before enabling linked bookings, verify that edits, moves, cancellation, and checkout act on the same appointment and preserve its reservations and payment history.
- The linked-services draft supports creation and editing from the calendar. Managers can replace a service, change its provider, and add, remove, or retime later services. The first service keeps its start time when editing the service list. Reschedule moves the full appointment, including any gaps. A conflict preserves both the saved appointment and the unsaved draft. Changes update the same sale, preserve prices for retained services, and stop once a payment or package redemption exists. Day and Week show each reservation, Month counts the appointment once, and providers with access to their own calendar see their assigned services.
- The front-desk draft stores Waiting room, In service, and Checking out on the existing appointment. New check-ins offer either arrival choice. Starting service unlocks checkout, and a return to the calendar can resume the same sale. Finish checkout requires a settled balance and records the appointment as Completed. Existing Arrived appointments keep their checkout access. Provider notification remains a separate step for implementation.
- Processor and device flows follow the provider contract in [Commerce foundation](05_commerce_foundation.md). Verify payment completion, callbacks, retries, and receipts in a connected test workspace before exposing a Charge action.
