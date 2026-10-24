import Link from "next/link";

export const metadata = { title: "Admin guide | BHI LMS" };

/**
 * Fill these in with your real admin paths. A step only shows an "Open" button
 * when its path is set, so nothing here can send an admin to a 404.
 */
const ROUTES: Record<string, string | undefined> = {
  dashboard: "/admin",
  courses: undefined, // e.g. "/admin/courses"
  classes: undefined, // e.g. "/admin/classes"
  instructors: undefined, // e.g. "/admin/instructors"
  applications: "/admin/applications",
};

const CHAIN = [
  { name: "Course", note: "What students choose when they enroll" },
  { name: "Class", note: "One running group of that course" },
  { name: "Teacher", note: "Assigned to the class by you" },
  { name: "Students", note: "Approved by you, placed in the class" },
  { name: "Attendance and reports", note: "Teachers record them, you watch them" },
];

const ROLES = [
  {
    who: "You (admin)",
    can: "Create courses and classes, approve teachers and students, assign teachers, place students, monitor everything.",
  },
  {
    who: "Teacher",
    can: "Sees only the classes you assign. Takes attendance and writes monthly progress reports.",
  },
  {
    who: "Student",
    can: "Registers, fills in the enrollment forms, waits for your decision, then checks in to class.",
  },
];

type Step = {
  id: string;
  title: string;
  why: string;
  actions: string[];
  done: string;
  tip?: string;
  route?: string;
  routeLabel?: string;
};

const STEPS: Step[] = [
  {
    id: "password",
    title: "Set your own password",
    why: "Your first password is a one-time password. Replace it before you do anything else.",
    actions: [
      "Sign in with your email and the one-time password you were given.",
      "Sign out, then click Forgot password on the sign-in page.",
      "Enter your email. A 6-digit code arrives in your inbox.",
      "Enter the code and choose a new password.",
    ],
    done: "You can sign in with your own password.",
  },
  {
    id: "courses",
    title: "Create the courses",
    why: "Students can only pick from courses you have created. With no courses, nobody can finish enrolling.",
    actions: [
      "Open Courses and classes in the admin menu.",
      "Add every course BHI offers, one at a time.",
      "Read the list back and check that nothing is missing.",
    ],
    done: "Every course students should be able to choose appears in the list.",
    tip: "This is the most common reason a new site looks empty or broken. Do this first.",
    route: "courses",
    routeLabel: "Open courses",
  },
  {
    id: "classes",
    title: "Create the classes",
    why: "A class is a real group of students who study one course together.",
    actions: [
      "Open a course and add a new class.",
      "Give it a clear class code.",
      "Choose its funding program: Private, EQISS, DFS, or Mixed.",
      "Save it.",
    ],
    done: "Each course has at least one class with the right funding program.",
    tip: "A student can only join a class whose funding matches their category, or a Mixed class. You can override with Allow funding mismatch, but the override is recorded in the audit log.",
    route: "classes",
    routeLabel: "Open classes",
  },
  {
    id: "teachers",
    title: "Add and approve teachers",
    why: "A teacher cannot see or do anything until you approve their account.",
    actions: [
      "Teachers sign up themselves at the instructor sign-up page, or you invite them from the admin side.",
      "Open the instructors list and find the new teacher marked as waiting.",
      "Approve them.",
    ],
    done: "The teacher shows as approved in the instructors list.",
    route: "instructors",
    routeLabel: "Open teachers",
  },
  {
    id: "assign",
    title: "Assign teachers to courses and classes",
    why: "This is the step that makes a teacher see their students.",
    actions: [
      "From a class page: pick the teacher and assign them.",
      "Or from a teacher page: pick the class (classes are listed by course).",
      "To change the lead teacher, choose Replace current lead. The old lead becomes an assistant.",
      "Add more teachers to the same class as assistants if needed.",
    ],
    done: "The class page shows its lead teacher, and the teacher received an email.",
    tip: "Each class has one lead. You cannot assign archived classes or disabled accounts. The dashboard counts classes with no teacher: aim for zero.",
    route: "instructors",
    routeLabel: "Open teachers",
  },
  {
    id: "applications",
    title: "Review applications and place students",
    why: "Students register, confirm their email, and fill in forms. Their application then waits for your decision.",
    actions: [
      "Open Applications and open one.",
      "Check the forms, documents and signatures.",
      "Approve: the student is enrolled in the course they chose.",
      "Reject: the application is declined. You can reopen it later.",
      "Request resubmission: write a note saying what to fix. The student gets it by email and only the flagged sections reopen.",
      "After approving, place the student in a class from the class page.",
    ],
    done: "The application is no longer waiting, and approved students appear in a class.",
    tip: "Private students: record tuition as Paid or Waived before approving. Funded students (EQISS, DFS) never get a payment status.",
    route: "applications",
    routeLabel: "Open applications",
  },
];

const CHECKS = [
  {
    where: "Dashboard warnings",
    tells: "Anything outstanding, such as missing setup or official form text.",
    often: "Every time you sign in",
  },
  {
    where: "Applications waiting",
    tells: "Students waiting for your decision.",
    often: "Daily",
  },
  {
    where: "Classes with no teacher",
    tells: "Classes with students that nobody is teaching.",
    often: "Daily",
  },
  {
    where: "Check-in flags",
    tells: "Check-ins the saved attendance sheet does not match, and students checking in from the same phone.",
    often: "Weekly",
  },
  {
    where: "Attendance sheets",
    tells: "Monthly sheets for DFS and Private students. Biweekly report for EQISS and One-Stop.",
    often: "Weekly",
  },
  {
    where: "Monthly progress reports",
    tells: "One report per student per month, signed by the teacher.",
    often: "Monthly",
  },
  {
    where: "Audit log",
    tells: "Every admin action, sign-in, and staff file download.",
    often: "When something looks wrong",
  },
];

const PROBLEMS = [
  {
    problem: "A student cannot choose a course.",
    fix: "No courses exist yet. Create them in step 2.",
  },
  {
    problem: "A teacher cannot see any students.",
    fix: "They are not approved (step 4), or not assigned to the class (step 5).",
  },
  {
    problem: "I cannot assign a teacher.",
    fix: "The class is archived or the teacher account is disabled.",
  },
  {
    problem: "I cannot put a student in a class.",
    fix: "The funding program does not match. Use Allow funding mismatch only if you mean to.",
  },
  {
    problem: "I cannot approve a Private student.",
    fix: "Tuition is still Pending. Mark it Paid or Waived first.",
  },
  {
    problem: "A page says 404 Page not found.",
    fix: "Sign out and back in. If it continues, send the page address to your developer.",
  },
];

export default function AdminGuidePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-[#1B2B28] sm:px-6">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Run BHI in six steps, then keep watch
        </h1>
        <p className="mt-3 text-lg text-[#4A5E59]">
          Everything in this system follows one chain. Set it up from left to right and
          nothing will be missing.
        </p>
      </header>

      <ol className="mt-8 flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0">
        {CHAIN.map((c, i) => (
          <li key={c.name} className="flex flex-1 flex-col md:flex-row md:items-center">
            <div className="flex-1 rounded-xl border border-[#D5E0DB] bg-[#EEF4F1] p-4 md:h-full">
              <p className="font-semibold text-[#1F4E46]">{c.name}</p>
              <p className="mt-1 text-sm text-[#4A5E59]">{c.note}</p>
            </div>
            {i < CHAIN.length - 1 && (
              <span
                aria-hidden="true"
                className="py-1 text-center text-xl text-[#1F4E46] md:px-2 md:py-0"
              >
                <span className="md:hidden">&#8595;</span>
                <span className="hidden md:inline">&#8594;</span>
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.who} className="rounded-xl border border-[#D5E0DB] bg-white p-4">
            <p className="font-semibold">{r.who}</p>
            <p className="mt-1 text-sm text-[#4A5E59]">{r.can}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Guide sections" className="hidden self-start lg:sticky lg:top-6 lg:block">
          <ul className="space-y-1 border-l-2 border-[#D5E0DB] text-sm">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={"#" + s.id}
                  className="-ml-0.5 block border-l-2 border-transparent py-1.5 pl-4 text-[#4A5E59] hover:border-[#1F4E46] hover:text-[#1F4E46] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1F4E46]"
                >
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#monitor"
                className="-ml-0.5 block border-l-2 border-transparent py-1.5 pl-4 text-[#4A5E59] hover:border-[#1F4E46] hover:text-[#1F4E46] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1F4E46]"
              >
                7. Monitor everything
              </a>
            </li>
            <li>
              <a
                href="#problems"
                className="-ml-0.5 block border-l-2 border-transparent py-1.5 pl-4 text-[#4A5E59] hover:border-[#1F4E46] hover:text-[#1F4E46] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1F4E46]"
              >
                If something looks wrong
              </a>
            </li>
          </ul>
        </nav>

        <div className="space-y-6">
          {STEPS.map((s, i) => {
            const href = s.route ? ROUTES[s.route] : undefined;
            return (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-6 rounded-2xl border border-[#D5E0DB] bg-white p-5 sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1F4E46] text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-semibold">{s.title}</h2>
                    <p className="mt-1 text-[#4A5E59]">{s.why}</p>
                  </div>
                  {href && (
                    <Link
                      href={href}
                      className="hidden shrink-0 rounded-lg bg-[#1F4E46] px-3 py-2 text-sm font-medium text-white hover:bg-[#173C36] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E46] sm:block"
                    >
                      {s.routeLabel}
                    </Link>
                  )}
                </div>

                <ul className="mt-5 space-y-2">
                  {s.actions.map((a) => (
                    <li key={a} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1F4E46]"
                      />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-5 rounded-lg bg-[#EEF4F1] px-4 py-3 text-sm">
                  <span className="font-semibold text-[#1F4E46]">Done when: </span>
                  {s.done}
                </p>

                {s.tip && (
                  <p className="mt-3 rounded-lg border border-[#E8D3A3] bg-[#FBF4E2] px-4 py-3 text-sm text-[#5C4513]">
                    <span className="font-semibold">Good to know: </span>
                    {s.tip}
                  </p>
                )}

                {href && (
                  <Link
                    href={href}
                    className="mt-4 inline-block rounded-lg bg-[#1F4E46] px-3 py-2 text-sm font-medium text-white hover:bg-[#173C36] sm:hidden"
                  >
                    {s.routeLabel}
                  </Link>
                )}
              </section>
            );
          })}

          <section
            id="monitor"
            className="scroll-mt-6 rounded-2xl border border-[#D5E0DB] bg-white p-5 sm:p-6"
          >
            <div className="flex items-start gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1F4E46] text-sm font-semibold text-white">
                7
              </span>
              <div>
                <h2 className="text-xl font-semibold">Monitor everything</h2>
                <p className="mt-1 text-[#4A5E59]">
                  Once setup is done, this is your routine. It tells you whether the system
                  is healthy.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#D5E0DB] text-[#4A5E59]">
                    <th className="py-2 pr-4 font-semibold">Where to look</th>
                    <th className="py-2 pr-4 font-semibold">What it tells you</th>
                    <th className="py-2 font-semibold">How often</th>
                  </tr>
                </thead>
                <tbody>
                  {CHECKS.map((c) => (
                    <tr key={c.where} className="border-b border-[#E6EEEA] align-top">
                      <td className="py-3 pr-4 font-medium">{c.where}</td>
                      <td className="py-3 pr-4 text-[#4A5E59]">{c.tells}</td>
                      <td className="py-3 whitespace-nowrap">{c.often}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-5 rounded-lg bg-[#EEF4F1] px-4 py-3 text-sm">
              <span className="font-semibold text-[#1F4E46]">How attendance works: </span>
              a teacher (or you, from the class page) starts a check-in. Students enter a
              6-digit code that changes every 30 seconds. When check-in closes, the sheet is
              pre-filled and the teacher reviews it. The saved sheet is the official record.
            </p>

            <p className="mt-3 rounded-lg border border-[#E8D3A3] bg-[#FBF4E2] px-4 py-3 text-sm text-[#5C4513]">
              <span className="font-semibold">Need to remove access? </span>
              Disable the account. The person is signed out everywhere and cannot sign in.
              You can re-enable it later.
            </p>

            {ROUTES.dashboard && (
              <Link
                href={ROUTES.dashboard}
                className="mt-4 inline-block rounded-lg bg-[#1F4E46] px-3 py-2 text-sm font-medium text-white hover:bg-[#173C36] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E46]"
              >
                Open dashboard
              </Link>
            )}
          </section>

          <section id="problems" className="scroll-mt-6">
            <h2 className="text-xl font-semibold">If something looks wrong</h2>
            <p className="mt-1 text-[#4A5E59]">Tap a problem to see the fix.</p>
            <div className="mt-4 space-y-2">
              {PROBLEMS.map((p) => (
                <details
                  key={p.problem}
                  className="group rounded-xl border border-[#D5E0DB] bg-white px-4 py-3 open:bg-[#EEF4F1]"
                >
                  <summary className="cursor-pointer list-none font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1F4E46]">
                    <span className="flex items-center justify-between gap-3">
                      {p.problem}
                      <span
                        aria-hidden="true"
                        className="text-[#1F4E46] transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-[#4A5E59]">{p.fix}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}