#!/bin/bash

# Example: Batch generate special diet forms for multiple students

# Create output directory
mkdir -p generated_forms

echo "Generating special diet forms..."
echo ""

# Example 1: ODSB form for a student with peanut allergy
echo "1. Generating ODSB form for student with peanut allergy..."
./generate_special_diet_form.sh \
  -n "Emma Johnson" \
  -s "Riverside Public School" \
  -g "3" \
  -a "Peanuts" \
  -d "Dr. Sarah Wilson" \
  -p "613-555-0123" \
  -o "generated_forms/Emma_Johnson_ODSB_Diet_Form.txt"

# Example 2: ODSB form for a student with multiple allergies
echo ""
echo "2. Generating ODSB form for student with multiple allergies..."
./generate_special_diet_form.sh \
  -n "Michael Chang" \
  -s "Lincoln High School" \
  -g "10" \
  -a "Peanuts, Tree Nuts, Shellfish" \
  -c "Celiac Disease" \
  -d "Dr. Robert Chen" \
  -o "generated_forms/Michael_Chang_ODSB_Diet_Form.txt"

# Example 3: ODSB form for a student with medical dietary needs
echo ""
echo "3. Generating ODSB form for student with medical dietary needs..."
./generate_special_diet_form.sh \
  -n "Sofia Martinez" \
  -s "Oak Park Public School" \
  -g "6" \
  -a "Milk, Eggs" \
  -c "Type 1 Diabetes" \
  -d "Dr. Jennifer Lee" \
  -p "613-555-0456" \
  -o "generated_forms/Sofia_Martinez_ODSB_Diet_Form.txt"

# Example 4: ODSP form for a disability support recipient with peanut allergy
echo ""
echo "4. Generating ODSP form for disability support recipient with peanut allergy..."
./generate_odsp_special_diet_form.sh \
  -n "John Doe" \
  -c "12345678" \
  -d "01/15/1965" \
  -a "Peanut" \
  -m "Anaphylactic Peanut Allergy" \
  -r "Severe allergic reaction requiring complete dietary exclusion of peanuts" \
  -p "Dr. Robert Johnson" \
  -o "generated_forms/John_Doe_ODSP_Form.txt"

# Example 5: ODSP form for someone with celiac disease
echo ""
echo "5. Generating ODSP form for someone with celiac disease..."
./generate_odsp_special_diet_form.sh \
  -n "Patricia Smith" \
  -c "87654321" \
  -d "07/20/1960" \
  -a "Gluten, Wheat, Barley" \
  -m "Celiac Disease" \
  -r "Medical requirement for gluten-free diet due to celiac disease diagnosis" \
  -p "Dr. Elizabeth Brown" \
  -o "generated_forms/Patricia_Smith_ODSP_Form.txt"

# Example 6: ODSB form with peanut allergy (your case)
echo ""
echo "6. Generating ODSB form with your peanut allergy..."
./generate_special_diet_form.sh \
  --peanut \
  -n "Your Name Here" \
  -s "Your School Name" \
  -g "Your Grade" \
  -o "generated_forms/Your_Name_ODSB_Peanut_Allergy.txt"

# Example 7: ODSP form with peanut allergy (your case)
echo ""
echo "7. Generating ODSP form with your peanut allergy..."
./generate_odsp_special_diet_form.sh \
  --peanut \
  -n "Your Name Here" \
  -c "Your ODSP Case ID" \
  -d "Your Date of Birth MM/DD/YYYY" \
  -m "Peanut Allergy" \
  -r "Documented allergy requiring complete avoidance of peanuts and peanut products" \
  -o "generated_forms/Your_Name_ODSP_Peanut_Allergy.txt"

echo ""
echo "✓ All forms generated successfully!"
echo ""
echo "Generated forms are located in: generated_forms/"
echo ""
ls -lah generated_forms/
echo ""
echo "Next steps:"
echo "1. Open each form and review the pre-filled information"
echo "2. Edit any fields that need correction"
echo "3. For school forms: Have parent/guardian sign"
echo "4. For ODSP forms: Have physician complete the medical section"
echo "5. Submit to appropriate authority"
echo ""
