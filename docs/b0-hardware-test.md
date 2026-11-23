# B0: hardware test on a real Windows PC (about 30 minutes)

Needs: a Windows 10/11 PC, a thermal printer (ideally a network Xprinter such as XP-80C with LAN, and
if possible a USB one too), the installer `Qwicoo-Print-Setup-<version>.exe`, and a Qwicoo branch
with Kitchen printing turned on (staging or a test branch, not a live restaurant).

Write down the result of each step (✅ / ❌ + a photo of the ticket when something looks wrong).

## A. Install and pair
1. Run the installer. If SmartScreen warns: "More info" → "Run anyway". The app opens.
2. In Qwicoo (branch admin): Branch settings → Service → Kitchen & printing → Paired printers →
   **Pair a device**. Type the code into the app, keep the name, press **Connect**.
   - Expected: the app moves to "Choose the kitchen printer" and shows "Connected to <branch>".
   - In Qwicoo, the device appears in Paired printers as "Windows app".

## B. Network printer
3. Print the printer's self-test page (hold FEED while switching it on) and note its IP address.
4. In the app: Network printer → type the IP → **Check printer**. Expected: "Printer found: Ready".
5. **Test print**. Expected: a small ticket "TEST / Test ticket" comes out and the paper is cut.
   Check the Arabic text is joined and readable (switch the app to Arabic and test print again).
6. **Use this printer**. Expected: status "Printing new orders", printer status "Ready".
7. Place a POS or QR order in the branch. Expected: a ticket prints within ~5 seconds; the order
   shows "Preparing" in Qwicoo.

## C. Printer problems (network printer)
8. Open the paper cover. Within ~40 s cashiers get "Kitchen printer cover is open"; the app shows
   "Cover open". Place an order: it must NOT print and stays "Submitted".
9. Close the cover. Expected: the waiting ticket prints within ~15 s; Qwicoo shows "printer is back".
10. Take the paper roll out (or let it run out). Expected: "Out of paper" alert; orders wait.
    Put paper back: waiting tickets print.
11. Unplug the printer's network cable for 1 minute. Expected: "offline" alert; tickets print when
    plugged back.
- If any of 8–11 shows "Can't report status" instead: note the printer model; printing still works,
  only the alerts are missing for that model.

## D. USB printer (if available)
12. Install the printer's Windows driver so it appears in Windows' printer list.
13. In the app: Change printer → USB printer → pick it → **Test print**. Expected: ticket prints.
14. **Use this printer**, place an order: ticket prints. Unplug the USB cable: status "Offline".

## E. Reliability
15. Close the app window: it keeps printing (icon in the tray). Place an order: it prints.
16. Restart the PC and don't touch anything. Place an order: it prints.
17. In Qwicoo, **Unpair** the device. Expected: within 30 s the app says "This PC was unpaired".

## F. Send back
- The results list, photos of: the Arabic test ticket, a real order ticket, and any odd output.
- In the app: **Copy diagnostics** and paste it into the message.
