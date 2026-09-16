import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface SearchableDropdownProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  allLabel?: string;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Search...',
  allLabel = 'All',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search input when opening dropdown
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = options.filter(opt =>
    opt.toLowerCase().includes(searchTerm.toLowerCase().trim())
  );

  const handleSelect = (opt: string) => {
    onChange(opt);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {label && (
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full min-h-[38px] px-3 py-2 border border-slate-200 rounded-xl bg-white flex items-center justify-between cursor-pointer font-medium text-xs text-slate-700 transition-all select-none ${
          isOpen ? 'ring-2 ring-indigo-500/20 border-indigo-500' : 'hover:border-slate-300'
        }`}
      >
        <span className={`break-words whitespace-normal leading-snug mr-1 ${value ? 'text-slate-800 font-semibold' : 'text-slate-500'}`}>
          {value || allLabel}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-slate-200/90 rounded-xl shadow-xl p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150 min-w-[260px] max-w-[360px] w-full">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={placeholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 font-medium text-xs">
            {/* All Options Selection */}
            <div
              onClick={() => handleSelect('')}
              className={`px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                !value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="break-words whitespace-normal">{allLabel}</span>
              {!value && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-2" />}
            </div>

            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <div
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  className={`px-3 py-2 rounded-lg cursor-pointer flex items-start justify-between gap-2 transition-colors ${
                    value === opt ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="break-words whitespace-normal leading-relaxed text-left flex-1">{opt}</span>
                  {value === opt && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />}
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-center text-slate-400 text-xs italic">
                No matching options
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
