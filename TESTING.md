# Staging test script (non-technical)

Use a staging site with Stripe **test** keys and real email. Tick each line. Stripe test card: 4242 4242 4242 4242, any future date, any CVC.

## A. Setup
- [ ] Run `npm run db:setup` and `npm run db:seed`. Courses and classes shows 15 courses with hours and Private totals.
- [ ] Sign in as admin. Home shows a "To do" list. Help opens the guide.

## B. Private student
- [ ] Register with a Gmail address and verify with the emailed code.
- [ ] Choose Private, then a course. The price is shown and you are taken to Tuition payment.
- [ ] The forms show a lock in the left menu before paying.
- [ ] Press Pay, then Cancel on Stripe. You return to the payment page with a warning.
- [ ] Pay with the test card. You return to enrollment, the forms open, and a "Payment received" email arrives.
- [ ] Fill in all 7 Common and 3 Private forms. The Enrollment Agreement shows your name, course and fees. Answer "Yes" to an arrest question without explaining: you are asked to explain.
- [ ] Upload a resume and photo ID, then Review and submit.

## C. EQISS and DFS students
- [ ] EQISS: choose a county. No prices anywhere, no payment step, and only the Non-Private agreement after the Common forms.
- [ ] DFS: same check.

## D. Admin review
- [ ] Open the Private application. It shows "Paid online" with the Stripe reference.
- [ ] Request corrections: an email panel opens addressed to the student. Tick "Student Data", write a message and Send. The email arrives.
- [ ] As the student, sign in. You land on the message with a link to Student Data. Save it: you go straight to Review, not to other forms. Resubmit.
- [ ] Approve. The student's dashboard shows the course and one Google Classroom button, with no application status.

## E. Attendance
- [ ] As admin, open the class and set class times in Class settings: start 9:00, end 15:00, lunch 12:00–12:30.
- [ ] Daily attendance: mark one student Present (keep the times), one Late (time in 9:40), one Sick. Save. Hours are 5.5, 4.83 and 0.
- [ ] Sign the day.
- [ ] As the EQISS student, open the biweekly report. Today shows the times (or "S" for sick). Initials are empty for the student to fill.
- [ ] As instructor, change a day on the biweekly report to "H". The daily attendance for that day now shows Holiday.
- [ ] As the DFS or Private student, open the monthly sheet and sign. The signed days show your signature.
- [ ] Move the student to another class. Their earlier attendance stays under "Earlier classes", and the class page shows instructor history.
- [ ] Withdraw the student from all classes. They can still sign in and see their earlier attendance.

## F. Permissions
- [ ] As a student, change the address bar to another student's attendance link. You get "not found".
- [ ] As an instructor, open a class you don't teach by changing the link. You get "not found".

## G. PDFs
- [ ] Download the application PDF (Private and EQISS) and compare it with the paper forms. The EQISS PDF has no fee forms.
- [ ] Download a monthly sheet, a biweekly report and a progress report PDF.
