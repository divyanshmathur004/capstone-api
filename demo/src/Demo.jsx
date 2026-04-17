import { useEffect, useMemo, useRef, useState } from 'react'
import { API_URL, autocompleteVillage } from './services/api'

const INITIAL_FORM = {
  fullName: '',
  email: '',
  phone: '',
  village: '',
  subDistrict: '',
  district: '',
  state: '',
  country: 'India',
  message: '',
}

function formatSuggestion(item) {
  const villageName = item?.hierarchy?.village || item?.label || ''
  const subDistrict = item?.hierarchy?.subDistrict || ''
  const district = item?.hierarchy?.district || ''
  const state = item?.hierarchy?.state || ''
  return `${villageName} (${subDistrict}, ${district}, ${state})`
}

export default function Demo() {
  const [form, setForm] = useState(INITIAL_FORM)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const debounceRef = useRef(null)
  const villageInputRef = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setLoading(false)
      setError('')
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const items = await autocompleteVillage(q)
        setSuggestions(items)
        setShowDropdown(true)
      } catch (err) {
        const apiMessage = err?.response?.data?.message
        setError(apiMessage || 'Could not load village suggestions. Please try again.')
        setSuggestions([])
        setShowDropdown(true)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query])

  const canShowDropdown = useMemo(() => {
    return showDropdown && (loading || error || suggestions.length > 0)
  }, [showDropdown, loading, error, suggestions.length])

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleAutocompleteTyping = (value) => {
    updateField('village', value)
    setQuery(value)
    setShowDropdown(true)

    if (!value.trim()) {
      setSuggestions([])
      setError('')
      updateField('subDistrict', '')
      updateField('district', '')
      updateField('state', '')
      updateField('country', 'India')
    }
  }

  const selectSuggestion = (item) => {
    const villageName = item?.hierarchy?.village || item?.label || ''
    const subDistrict = item?.hierarchy?.subDistrict || ''
    const district = item?.hierarchy?.district || ''
    const state = item?.hierarchy?.state || ''
    const country = item?.hierarchy?.country || 'India'

    setForm((prev) => ({
      ...prev,
      village: villageName,
      subDistrict,
      district,
      state,
      country,
    }))
    setQuery(villageName)
    setShowDropdown(false)
    setSuggestions([])
    setError('')
    villageInputRef.current?.blur()
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,_#cffafe_0%,_transparent_45%),radial-gradient(circle_at_80%_0%,_#fef3c7_0%,_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#f1f5f9_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-7 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Phase 1 Demo Client</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Location Contact Form Demo</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
            Connected to
            <span className="mx-1 rounded-md bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-800">{API_URL}/api/v1/autocomplete?q=</span>
            with auto-fill for address hierarchy.
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-[0_14px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-800">Contact Details</h2>
          </div>

          <form className="grid grid-cols-1 gap-5 px-6 py-6 sm:grid-cols-2 sm:gap-6">
            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                className="field-input"
                type="text"
                value={form.fullName}
                onChange={(e) => updateField('fullName', e.target.value)}
                placeholder="Enter full name"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="email">Email</label>
              <input
                id="email"
                className="field-input"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="phone">Phone</label>
              <input
                id="phone"
                className="field-input"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="+91 98XXXXXXXX"
              />
            </div>

            <div className="sm:col-span-1" ref={wrapperRef}>
              <label className="field-label" htmlFor="village">Village/Area (autocomplete)</label>
              <div className="relative">
                <input
                  id="village"
                  ref={villageInputRef}
                  className="field-input"
                  type="text"
                  value={form.village}
                  onFocus={() => setShowDropdown(true)}
                  onChange={(e) => handleAutocompleteTyping(e.target.value)}
                  placeholder="Type minimum 2 characters"
                  autoComplete="off"
                />

                {canShowDropdown && (
                  <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {loading && (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
                        Loading suggestions...
                      </div>
                    )}

                    {!loading && error && (
                      <div className="px-3 py-2.5 text-sm text-rose-600">{error}</div>
                    )}

                    {!loading && !error && suggestions.length === 0 && query.trim().length >= 2 && (
                      <div className="px-3 py-2.5 text-sm text-slate-500">No matching villages found.</div>
                    )}

                    {!loading && !error && suggestions.map((item) => (
                      <button
                        key={`${item.value}-${item.label}`}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-cyan-50 last:border-b-0"
                        onClick={() => selectSuggestion(item)}
                      >
                        {formatSuggestion(item)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="subDistrict">SubDistrict</label>
              <input id="subDistrict" className="field-input field-input-readonly" type="text" value={form.subDistrict} readOnly />
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="district">District</label>
              <input id="district" className="field-input field-input-readonly" type="text" value={form.district} readOnly />
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="state">State</label>
              <input id="state" className="field-input field-input-readonly" type="text" value={form.state} readOnly />
            </div>

            <div className="sm:col-span-1">
              <label className="field-label" htmlFor="country">Country</label>
              <input id="country" className="field-input field-input-readonly" type="text" value={form.country} readOnly />
            </div>

            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="message">Message</label>
              <textarea
                id="message"
                className="field-input min-h-[120px] resize-y"
                value={form.message}
                onChange={(e) => updateField('message', e.target.value)}
                placeholder="Write your message"
              />
            </div>

            <div className="sm:col-span-2">
              <button
                type="button"
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Submit (Demo Only)
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
