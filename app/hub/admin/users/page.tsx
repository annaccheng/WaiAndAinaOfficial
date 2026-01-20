"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

type UserItem = {
  id: string;
  name: string;
  userType: string;
  number: string;
  active: boolean;
  capabilities?: { id: string; name: string }[];
};

type CapabilityOption = { id: string; name: string };

const ROLE_OPTIONS = [
  "Admin",
  "Volunteer",
  "External Volunteer",
  "Inactive Volunteer",
];

export default function AdminUsersPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityOption[]>([]);
  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityMessage, setCapabilityMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    role: "",
    status: "",
  });
  const [newUser, setNewUser] = useState({
    name: "",
    userType: "Volunteer",
    number: "",
  });
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [editDraft, setEditDraft] = useState({
    id: "",
    name: "",
    userType: "Volunteer",
    number: "",
    active: true,
    password: "",
    capabilityIds: [] as string[],
  });

  useEffect(() => {
    const session = loadSession();
    if (!session?.name) {
      router.replace("/");
      return;
    }
    const isAdmin = (session.userType || "").toLowerCase() === "admin";
    if (!isAdmin) {
      setMessage("Admin access required.");
      return;
    }
    setAuthorized(true);
  }, [router]);

  const stats = useMemo(() => {
    const activeCount = users.filter((user) => user.active).length;
    const inactiveCount = users.length - activeCount;
    return { total: users.length, active: activeCount, inactive: inactiveCount };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const search = filters.search.toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(search) ||
        (user.number || "").toLowerCase().includes(search);
      const matchesRole = filters.role
        ? user.userType.toLowerCase() === filters.role.toLowerCase()
        : true;
      const matchesStatus = filters.status
        ? filters.status === "active"
          ? user.active
          : !user.active
        : true;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [filters.role, filters.search, filters.status, users]);

  useEffect(() => {
    if (!authorized) return;
    const loadUsers = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/users");
        const json = await res.json();
        setUsers(json.users || []);
      } catch (err) {
        console.error("Failed to load users", err);
        setMessage("Unable to load users.");
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, [authorized]);

  useEffect(() => {
    if (!authorized) return;
    loadCapabilities();
  }, [authorized]);

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) throw new Error("Failed to create user");
      setMessage("User created with default passcode WAIANDAINA.");
      setNewUser({ name: "", userType: "Volunteer", number: "" });
      const refreshed = await fetch("/api/users");
      const json = await refreshed.json();
      setUsers(json.users || []);
    } catch (err: any) {
      setMessage(err?.message || "Could not create user.");
    }
  };

  const startEditing = (user: UserItem) => {
    setEditing(user);
    setEditDraft({
      id: user.id,
      name: user.name,
      userType: user.userType || "Volunteer",
      number: user.number || "",
      active: user.active,
      password: "",
      capabilityIds: (user.capabilities || []).map((capability) => capability.id),
    });
  };

  const updateUser = async () => {
    if (!editDraft.id) return;
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editDraft.id,
          name: editDraft.name,
          userType: editDraft.userType,
          number: editDraft.number,
          active: editDraft.active,
          password: editDraft.password || undefined,
          capabilityIds: editDraft.capabilityIds,
        }),
      });
      if (!res.ok) throw new Error("Failed to update user.");
      setMessage("User updated.");
      setEditDraft((prev) => ({ ...prev, password: "" }));
      const refreshed = await fetch("/api/users");
      const json = await refreshed.json();
      setUsers(json.users || []);
    } catch (err: any) {
      setMessage(err?.message || "Could not update user.");
    }
  };

  const loadCapabilities = async () => {
    try {
      const res = await fetch("/api/capabilities");
      const json = await res.json();
      setCapabilities(json.capabilities || []);
    } catch (err) {
      console.error("Failed to load capabilities", err);
    }
  };

  const handleCreateCapability = async () => {
    const trimmed = capabilityName.trim();
    if (!trimmed) return;
    setCapabilityMessage(null);
    try {
      const res = await fetch("/api/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to add capability");
      setCapabilityName("");
      await loadCapabilities();
      setCapabilityMessage("Capability added.");
    } catch (err: any) {
      console.error("Failed to add capability", err);
      setCapabilityMessage(err?.message || "Could not add capability.");
    }
  };

  const toggleActive = async (user: UserItem) => {
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, active: !user.active }),
      });
      if (!res.ok) throw new Error("Failed to update user.");
      const refreshed = await fetch("/api/users");
      const json = await refreshed.json();
      setUsers(json.users || []);
    } catch (err) {
      console.error("Failed to toggle user", err);
    }
  };

  const deleteUser = async (user: UserItem) => {
    const confirmed = window.confirm(
      `Delete ${user.name}? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      if (!res.ok) throw new Error("Failed to delete user.");
      const refreshed = await fetch("/api/users");
      const json = await refreshed.json();
      setUsers(json.users || []);
      if (editing?.id === user.id) {
        setEditing(null);
      }
    } catch (err: any) {
      setMessage(err?.message || "Could not delete user.");
    }
  };

  if (!authorized) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-[#7a7f54]">
        {message || "Checking access..."}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <div className="rounded-3xl border border-[#d0c9a4] bg-white/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[#7a7f54]">Admin</p>
            <h1 className="text-2xl font-semibold text-[#314123]">User Management</h1>
            <p className="text-sm text-[#5f5a3b]">
              Add teammates, adjust roles, and keep the roster up to date.
            </p>
          </div>
          <Link
            href="/hub/admin"
            className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#314123] shadow-sm transition hover:bg-[#f1edd8]"
          >
            Back to admin
          </Link>
        </div>
        {message && <p className="mt-4 text-sm font-semibold text-[#4b5133]">{message}</p>}
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-xl border border-[#e2d7b5] bg-[#f9f6e7] px-4 py-3 text-[#4b5133]">
            <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">Total</div>
            <div className="text-lg font-semibold">{stats.total}</div>
          </div>
          <div className="rounded-xl border border-[#d0e0b5] bg-[#f1f6e5] px-4 py-3 text-[#4b5133]">
            <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">Active</div>
            <div className="text-lg font-semibold">{stats.active}</div>
          </div>
          <div className="rounded-xl border border-[#e3d2b5] bg-[#faf3e3] px-4 py-3 text-[#4b5133]">
            <div className="text-xs uppercase tracking-[0.12em] text-[#7a7f54]">Inactive</div>
            <div className="text-lg font-semibold">{stats.inactive}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Filters</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                placeholder="Search name or number"
              />
              <select
                value={filters.role}
                onChange={(e) => setFilters((prev) => ({ ...prev, role: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
              >
                <option value="">All roles</option>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Team directory</h2>
            <p className="text-sm text-[#5f5a3b]">
              Tap a teammate to open their detail panel and update roles or access.
            </p>
            <div className="mt-4 space-y-3">
              {loading && <p className="text-sm text-[#7a7f54]">Loading users…</p>}
              {!loading && !filteredUsers.length && (
                <p className="text-sm text-[#7a7f54]">No users match the current filters.</p>
              )}
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-col gap-3 rounded-xl border border-[#e2d7b5] bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-[#314123]">{user.name}</span>
                      <span
                        className={`rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] ${
                          user.active
                            ? "bg-[#dfeac1] text-[#2f3b21]"
                            : "bg-[#f3d7d7] text-[#7a3b3b]"
                        }`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="text-xs text-[#6b6d4b]">
                      {user.userType || "Unassigned"} • {user.number || "No number"}
                    </p>
                    {user.capabilities && user.capabilities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-[#4f5730]">
                        {user.capabilities.map((capability) => (
                          <span
                            key={capability.id}
                            className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-2 py-[2px] font-semibold"
                          >
                            {capability.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => startEditing(user)}
                      className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 font-semibold uppercase text-[#4f5730] shadow-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(user)}
                      className="rounded-md bg-[#8fae4c] px-3 py-2 font-semibold uppercase text-white shadow-sm"
                    >
                      {user.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUser(user)}
                      className="rounded-md border border-red-200 bg-white px-3 py-2 font-semibold uppercase text-red-700 shadow-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Add a new user</h2>
            <form className="mt-3 space-y-3 text-sm" onSubmit={handleCreateUser}>
              <div className="space-y-1">
                <label className="text-[#5f5a3b]">Name</label>
                <input
                  value={newUser.name}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  placeholder="New teammate"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[#5f5a3b]">Number</label>
                <input
                  value={newUser.number}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, number: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  placeholder="Phone or member number"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[#5f5a3b]">Role</label>
                <select
                  value={newUser.userType}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, userType: e.target.value }))}
                  className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-[#7a7f54]">
                Default passcode is set to WAIANDAINA for new accounts.
              </p>
              <button
                type="submit"
                className="w-full rounded-md bg-[#8fae4c] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md transition hover:bg-[#7e9c44]"
              >
                Add user
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">Capability tags</h2>
            <p className="text-sm text-[#5f5a3b]">
              Maintain the list of skills you can assign to users and tasks.
            </p>
            {capabilityMessage && (
              <p className="mt-2 text-sm font-semibold text-[#4b5133]">{capabilityMessage}</p>
            )}
            <div className="mt-3 flex gap-2">
              <input
                value={capabilityName}
                onChange={(e) => setCapabilityName(e.target.value)}
                className="flex-1 rounded-md border border-[#d0c9a4] px-3 py-2 text-sm"
                placeholder="Add new capability"
              />
              <button
                type="button"
                onClick={handleCreateCapability}
                className="rounded-md bg-[#8fae4c] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#f9f9ec]"
              >
                Add
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#4f5730]">
              {capabilities.length ? (
                capabilities.map((capability) => (
                  <span
                    key={capability.id}
                    className="rounded-full border border-[#d0c9a4] bg-[#f6f1dd] px-2 py-[2px] font-semibold"
                  >
                    {capability.name}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[#7a7f54]">No capabilities added yet.</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[#d0c9a4] bg-white/80 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#314123]">User details</h2>
            {editing ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="space-y-1">
                  <label className="text-[#5f5a3b]">Name</label>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#5f5a3b]">Number</label>
                  <input
                    value={editDraft.number}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, number: e.target.value }))}
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#5f5a3b]">Role</label>
                  <select
                    value={editDraft.userType}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, userType: e.target.value }))
                    }
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[#5f5a3b]">Capabilities</label>
                  <div className="flex flex-wrap gap-2 text-[11px] text-[#4f5730]">
                    {capabilities.length ? (
                      capabilities.map((capability) => {
                        const selected = editDraft.capabilityIds.includes(capability.id);
                        return (
                          <label
                            key={capability.id}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                              selected
                                ? "border-[#8fae4c] bg-[#eef4d4] font-semibold"
                                : "border-[#d0c9a4] bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) =>
                                setEditDraft((prev) => {
                                  const next = new Set(prev.capabilityIds);
                                  if (e.target.checked) {
                                    next.add(capability.id);
                                  } else {
                                    next.delete(capability.id);
                                  }
                                  return { ...prev, capabilityIds: Array.from(next) };
                                })
                              }
                              className="accent-[#8fae4c]"
                            />
                            {capability.name}
                          </label>
                        );
                      })
                    ) : (
                      <span className="text-xs text-[#7a7f54]">No capabilities yet.</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border border-[#e2d7b5] bg-[#f9f6e7] px-3 py-2">
                  <span className="text-sm font-semibold text-[#4b5133]">Active</span>
                  <input
                    type="checkbox"
                    checked={editDraft.active}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, active: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[#8fae4c]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[#5f5a3b]">Reset passcode</label>
                  <input
                    type="password"
                    value={editDraft.password}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, password: e.target.value }))
                    }
                    className="w-full rounded-md border border-[#d0c9a4] px-3 py-2 text-sm focus:border-[#8fae4c] focus:outline-none"
                    placeholder="New passcode (optional)"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={updateUser}
                    className="flex-1 rounded-md bg-[#a0b764] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#f9f9ec] shadow-md transition hover:bg-[#93a95d]"
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setEditDraft({
                        id: "",
                        name: "",
                        userType: "Volunteer",
                        number: "",
                        active: true,
                        password: "",
                        capabilityIds: [],
                      });
                    }}
                    className="rounded-md border border-[#d0c9a4] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#4f5730] shadow-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#7a7f54]">
                Select a teammate from the directory to update their details.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
